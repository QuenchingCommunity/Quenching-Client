import fs from 'fs-extra';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { path7z } from '7zip-bin-full';
import { extractZipArchive, getZipUncompressedBytes, type ZipExtractionOptions } from './zip-extraction';

// Executables and their DLLs must live outside ASAR, including in portable builds.
export function archiveToolPath(binary = path7z): string {
  return binary.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

async function run7z(args: string[], onOutput?: (chunk: string) => void, idleTimeoutMs = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(archiveToolPath(), args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '', bytes = 0, failure: Error | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const active = () => {
      if (!idleTimeoutMs) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        failure = new Error('解压长时间没有响应，已停止解压，请重试。');
        child.kill();
      }, idleTimeoutMs);
    };
    active();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      active();
      try {
        if (onOutput) onOutput(chunk);
        else {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 64 * 1024 * 1024) throw new Error('压缩包的文件列表过大。');
          output += chunk;
        }
      } catch (error) { failure = error as Error; child.kill(); }
    });
    child.stderr.on('data', (chunk: string) => { active(); errors = (errors + chunk).slice(-4000); });
    child.once('error', error => { clearTimeout(idleTimer); reject(error); });
    child.once('close', code => {
      clearTimeout(idleTimer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`压缩包读取或解压失败，请检查文件是否完整、是否需要密码。${errors.trim() ? `\n${errors.trim()}` : ''}`));
      else resolve(output);
    });
  });
}

function safeName(value: string): string {
  const name = value.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/$/, '');
  if (!name || /[\x00-\x1f]/.test(name) || name.startsWith('/') ||
      name.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error(`压缩包中包含不安全路径：${value}`);
  }
  return name;
}

interface ArchiveEntry { name: string; directory: boolean; bytes: number }

async function listArchive(archivePath: string, idleTimeoutMs = 0): Promise<ArchiveEntry[]> {
  const output = await run7z(['l', '-slt', '-ba', '-sccUTF-8', '-bd', '-p-', '--', path.resolve(archivePath)], undefined, idleTimeoutMs);
  const entries: ArchiveEntry[] = [];
  for (const block of output.split(/\r?\n\s*\r?\n/)) {
    if (!block.trim()) continue;
    const fields: Record<string, string> = {};
    for (const line of block.split(/\r?\n/)) {
      if (!line) continue;
      const separator = line.indexOf(' = ');
      if (separator < 0) throw new Error('无法安全读取压缩包文件列表。');
      const key = line.slice(0, separator);
      if (Object.prototype.hasOwnProperty.call(fields, key)) throw new Error('压缩包文件列表包含重复字段。');
      fields[key] = line.slice(separator + 3);
    }
    if (fields['Symbolic Link'] || fields['Hard Link'] || fields['Copy Link'] || fields['Reparse Point'] ||
        /\bl[rwx-]{9}\b/.test(fields.Attributes || '')) throw new Error('资源包不支持链接文件。');
    if (fields.Encrypted === '+') throw new Error('暂不支持加密资源包，请先解密后安装。');
    if (typeof fields.Path !== 'string') throw new Error('压缩包文件列表缺少路径。');
    const name = safeName(fields.Path);
    const directory = fields.Folder === '+' || /^D/.test(fields.Attributes || '');
    const bytes = Number(fields.Size);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`压缩包文件大小无效：${name}`);
    entries.push({ name, directory, bytes });
  }
  return entries;
}

function mappedName(name: string, directory: boolean, options: ZipExtractionOptions): string | null {
  let relative = name;
  const wrappers = options.stripLeadingDirectory;
  for (const wrapper of Array.isArray(wrappers) ? wrappers : wrappers ? [wrappers] : []) {
    if (relative.toLowerCase() === wrapper.toLowerCase()) return null;
    if (relative.toLowerCase().startsWith(`${wrapper.toLowerCase()}/`)) { relative = relative.slice(wrapper.length + 1); break; }
  }
  if (options.mapFile) relative = directory ? '' : options.mapFile(relative) || '';
  return relative ? safeName(relative) : null;
}

/** ZIP keeps its streaming reader; RAR/7z are extracted in one native pass, including solid archives. */
export async function extractArchive(archivePath: string, destination: string, options: ZipExtractionOptions & { nativeZip?: boolean; idleTimeoutMs?: number } = {}): Promise<number> {
  const extension = path.extname(archivePath).toLowerCase();
  if (extension === '.zip') {
    const { extractResourcePackage } = await import('./bundled-packages');
    const bundled = await extractResourcePackage(archivePath, destination, options);
    if (bundled !== null) return bundled;
  }
  if (extension === '.zip' && !options.nativeZip) return extractZipArchive(archivePath, destination, options);
  if (!['.zip', '.rar', '.7z'].includes(extension)) throw new Error(`不支持的压缩包格式：${extension}`);
  const entries = await listArchive(archivePath, options.idleTimeoutMs);
  // Validate every mapped path (and reject client packages) before extracting or moving anything.
  const mapped = entries.map(entry => ({ ...entry, target: mappedName(entry.name, entry.directory, options) }));
  const root = path.resolve(destination);
  const parent = path.dirname(root);
  const tempParent = path.basename(parent) === '_tmp' ? parent : path.join(parent, '_tmp');
  await fs.ensureDir(tempParent);
  if ((await fs.lstat(tempParent)).isSymbolicLink()) throw new Error('解压暂存目录不能是链接。');
  const staging = await fs.mkdtemp(path.join(tempParent, 'archive-extract-'));
  try {
    let lastProgress = -1;
    options.onProgress?.(0, path.basename(archivePath));
    const selected = mapped.filter(entry => !entry.directory && entry.target);
    const includes: string[] = [];
    if (selected.length !== entries.filter(entry => !entry.directory).length) {
      const list = path.join(tempParent, `${path.basename(staging)}.list`);
      await fs.writeFile(list, selected.map(entry => entry.name).join('\n') + '\n', 'utf8');
      includes.push('-scsUTF-8', '-spd', `-i@${list}`);
    }
    if (selected.length) await run7z(['x', '-y', '-aoa', '-bso0', '-bsp1', '-sccUTF-8', '-p-', ...includes, `-o${staging}`, '--', path.resolve(archivePath)], chunk => {
      for (const match of chunk.matchAll(/(\d+)%/g)) {
        const percent = Math.min(95, Math.floor(Number(match[1]) * .95));
        if (percent > lastProgress) { lastProgress = percent; options.onProgress?.(percent, path.basename(archivePath)); }
      }
    }, options.idleTimeoutMs);
    const key = (name: string) => process.platform === 'win32' ? name.toLowerCase() : name;
    const expected = new Map(selected.map(entry => [key(entry.name), entry]));
    const actual = new Map<string, string>();
    const visit = async (dir: string) => {
      for (const item of await fs.readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name);
        if (item.isSymbolicLink()) throw new Error('资源包不支持链接文件。');
        if (item.isDirectory()) await visit(file);
        else if (item.isFile()) {
          const name = key(path.relative(staging, file).replace(/\\/g, '/'));
          const entry = expected.get(name), stat = await fs.lstat(file);
          if (!entry || stat.nlink !== 1 || stat.size !== entry.bytes) throw new Error(`解压后的文件与压缩包列表不一致：${name}`);
          actual.set(name, file);
        } else throw new Error('资源包包含不支持的文件类型。');
      }
    };
    await visit(staging);
    if (actual.size !== expected.size) throw new Error('压缩包未完整解压。');
    await fs.ensureDir(root);
    const realRoot = await fs.realpath(root);
    const sizes = new Map<string, number>();
    for (const [index, entry] of mapped.entries()) {
      if (!entry.target || entry.directory) continue;
      const parts = entry.target.split('/');
      let parent = realRoot;
      // Do not follow links already present in the destination.
      for (const [index, part] of parts.entries()) {
        parent = path.join(parent, part);
        const stat = await fs.lstat(parent).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
        if (stat?.isSymbolicLink()) throw new Error(`安装路径包含链接：${entry.target}`);
        if (stat && (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
          throw new Error(`安装路径的文件类型冲突：${entry.target}`);
        }
      }
      const from = actual.get(key(entry.name));
      if (!from) throw new Error(`解压后缺少文件：${entry.name}`);
      const target = path.join(realRoot, ...parts);
      await fs.ensureDir(path.dirname(target));
      // A repeated archive entry already has its last value in the native output.
      if (await fs.pathExists(from)) await fs.move(from, target, { overwrite: true });
      sizes.set(entry.target.toLowerCase(), entry.bytes);
      options.onProgress?.(95 + Math.floor((index + 1) / mapped.length * 5), entry.name);
    }
    const bytes = [...sizes.values()].reduce((sum, size) => sum + size, 0);
    if (!Number.isSafeInteger(bytes)) throw new Error('压缩包总大小无效。');
    options.onProgress?.(100, path.basename(archivePath));
    return bytes;
  } finally {
    await fs.remove(staging);
    await fs.unlink(path.join(tempParent, `${path.basename(staging)}.list`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function getArchiveUncompressedBytes(archivePath: string): Promise<number> {
  if (path.extname(archivePath).toLowerCase() === '.zip') return getZipUncompressedBytes(archivePath);
  if (!['.rar', '.7z'].includes(path.extname(archivePath).toLowerCase())) throw new Error('不支持的压缩包格式。');
  const sizes = new Map((await listArchive(archivePath)).filter(entry => !entry.directory).map(entry => [entry.name.toLowerCase(), entry.bytes]));
  const bytes = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  if (!Number.isSafeInteger(bytes)) throw new Error('压缩包总大小无效。');
  return bytes;
}
