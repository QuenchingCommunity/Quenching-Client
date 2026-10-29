import fs from 'fs-extra';
import path from 'node:path';
import type { ZipExtractionOptions } from './zip-extraction';
import { resourcePath } from '../../shared/bundled-resource-paths.mjs';
import { ensureResourceSelection, readResourceManifest, hasResourceContext } from './bundled-assets';

async function describe(archive: string): Promise<{ quenching: string; prefix: string; files: Record<string, number> } | null> {
  if (path.extname(archive).toLowerCase() !== '.zip' || path.basename(path.dirname(archive)) !== 'quenching') return null;
  const quenching = path.dirname(archive), name = path.basename(archive);
  const prefix = `packages/${name.slice(0, -4)}/`;
  const loose = path.join(path.dirname(quenching), 'unpacked', prefix);
  if (!hasResourceContext(quenching) && await fs.pathExists(loose)) {
    const files: Record<string, number> = {};
    const walk = async (folder: string, relative: string) => {
      for (const item of await fs.readdir(folder, { withFileTypes: true })) {
        const full = path.join(folder, item.name), key = relative + item.name;
        if (item.isSymbolicLink()) throw new Error('Resource package contains a link');
        if (item.isDirectory()) await walk(full, key + '/');
        else if (item.isFile()) files[key] = (await fs.stat(full)).size;
      }
    };
    await walk(loose, '');
    return { quenching, prefix, files };
  }
  const manifest = await readResourceManifest(path.dirname(quenching));
  if (!manifest?.packages?.[name]) return null;
  return { quenching, prefix, files: Object.fromEntries(Object.entries(manifest.files)
    .filter(([file]) => file.startsWith(prefix)).map(([file, record]) => [file.slice(prefix.length), record.size])) };
}
export async function resourceArchiveExists(archive: string): Promise<boolean> {
  return !!await describe(archive) || await fs.pathExists(archive);
}
export async function resourcePackageNames(archive: string): Promise<string[] | null> {
  const info = await describe(archive);
  return info ? Object.keys(info.files) : null;
}
export async function resourcePackageBytes(archive: string): Promise<number | null> {
  const info = await describe(archive);
  return info ? Object.values(info.files).reduce((n, size) => n + size, 0) : null;
}
export async function extractResourcePackage(archive: string, destination: string, options: ZipExtractionOptions): Promise<number | null> {
  const info = await describe(archive);
  if (!info) return null;
  const selected: Array<{ name: string; target: string; size: number }> = [];
  for (const [name, size] of Object.entries(info.files)) {
    let target = name;
    const wrappers = options.stripLeadingDirectory;
    for (const wrapper of Array.isArray(wrappers) ? wrappers : wrappers ? [wrappers] : []) {
      if (target.toLowerCase().startsWith(wrapper.toLowerCase() + '/')) { target = target.slice(wrapper.length + 1); break; }
    }
    target = options.mapFile ? options.mapFile(target) || '' : target;
    if (!target) continue;
    if (target.includes('\\') || /[\x00-\x1f]/.test(target) || target.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
      throw new Error(`Unsafe resource package path: ${target}`);
    }
    selected.push({ name, target, size });
  }
  await ensureResourceSelection(info.quenching, selected.map(file => info.prefix + file.name));
  await fs.ensureDir(destination);
  const root = await fs.realpath(destination);
  let bytes = 0;
  options.onProgress?.(0, path.basename(archive));
  for (const [index, file] of selected.entries()) {
    let parent = root;
    const parts = file.target.split('/');
    for (const part of parts.slice(0, -1)) {
      parent = path.join(parent, part); await fs.ensureDir(parent);
      const stat = await fs.lstat(parent); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Resource destination contains a link: ${file.target}`);
    }
    const target = path.join(root, file.target);
    const stat = await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) throw new Error(`Resource destination is not an ordinary file: ${file.target}`);
    await fs.copyFile(resourcePath(info.quenching, info.prefix + file.name), target);
    bytes += file.size;
    options.onProgress?.(Math.floor((index + 1) / selected.length * 100), file.target);
  }
  options.onProgress?.(100, path.basename(archive));
  return bytes;
}
