import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BOOTSTRAP_ASSETS, RESOURCE_ARCHIVE, RESOURCE_ARCHIVES, RESOURCE_MANIFEST, resourceArchiveFor } from '../src/shared/bundled-resource-paths.mjs';
import { verifyReadabilityWriters } from './verify-readability-writers.mjs';

const require = createRequire(import.meta.url);
export async function fileHash(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function resourceInventory(root) {
  const files = {};
  async function walk(relative) {
    if(['offline.exe', 'backup'].includes(path.basename(relative).toLowerCase()))return;
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Resource source contains a link: ${relative}`);
    if (/[\x00-\x1f\\]/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) throw new Error(`Invalid resource source path: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(absolute)).sort()) await walk(`${relative}/${name}`);
    } else if (stat.isFile()) files[relative] = { size: stat.size, sha256: await fileHash(absolute) };
    else throw new Error(`Unsupported resource: ${relative}`);
  }
  for (const name of (await fs.readdir(root)).sort()) {
    if (name.startsWith('.') || BOOTSTRAP_ASSETS.includes(name) || /\.(zip|7z)$/i.test(name) || name === RESOURCE_MANIFEST) continue;
    await walk(name);
  }
  return files;
}
async function compress(source, target, names, previousArchive, remove = []) {
  const tool = require('7zip-bin-full').path7z;
  const list = path.join(path.dirname(target), 'files.txt');
  await fs.writeFile(list, names.join('\n') + '\n');
  const run = (args, cwd = source) => new Promise((resolve, reject) => {
    const child = spawn(tool, args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = '';
    let last = -10;
    child.stdout.on('data', chunk => { for (const match of String(chunk).matchAll(/(\d+)%/g)) {
      const percent = Number(match[1]); if (percent >= last + 10) { last = percent; console.log(`[Resources] Compressing ${percent}%`); }
    } });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`7z compression failed (${code}): ${errors}`)));
  });
  if (previousArchive) {
    await fs.copyFile(previousArchive, target);
    if (remove.length) {
      const removals = path.join(path.dirname(target), 'remove.txt');
      await fs.writeFile(removals, remove.join('\n') + '\n');
      await run(['d', '-y', '-spd', '-scsUTF-8', '-bso0', '-bsp1', target, `@${removals}`]);
    }
  }
  if (names.length) {
    // Deleting changed entries first forces same-size/same-mtime edits to update.
    // Unchanged independent 7z streams are copied without recompression.
    await run(['a', '-t7z', '-mx=5', '-m0=LZMA2', '-md=32m', '-ms=off', '-mmt=2', '-mtc=off', '-mta=off', '-mtm=off', '-scsUTF-8', '-spd', '-bso0', '-bsp1', target, `@${list}`]);
  } else if (!previousArchive) {
    // Native, valid zero-member 7z for an empty category; no placeholder payload.
    const empty=path.join(path.dirname(target),'empty-folder'); await fs.mkdir(empty);
    try { await run(['a','-t7z',target,'empty-folder','-x!empty-folder','-bso0','-bsp0'],path.dirname(target)); }
    finally { await fs.rmdir(empty); }
  }
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function prepareResourceBundle(root, { requireLegacy = true } = {}) {
  const started = performance.now();
  const source = path.join(root, 'assets/unpacked');
  const destination = path.join(root, 'assets/quenching');
  await verifyReadabilityWriters(path.join(source, 'shaders'));
  if (requireLegacy) for (const pack of ['shaders-300-legacy-hd', 'shaders-300-legacy-de', 'fog_shaders-legacy']) await fs.access(path.join(source, 'shaders', pack));
  const inventory = await resourceInventory(source);
  const files = Object.fromEntries(Object.entries(inventory).map(([name, record]) => [name, { ...record, archive: resourceArchiveFor(name) }]));
  const id = digest({ schema: 3, files });
  const manifestPath = path.join(destination, RESOURCE_MANIFEST);
  const previous = await fs.readFile(manifestPath, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; });
  const trustedPrevious = previous?.schema === 3 && previous.files && previous.id === digest({ schema: 3, files: previous.files });
  const legacyPath=path.join(destination,RESOURCE_ARCHIVE);
  const legacyReusable=previous?.schema===2 && previous.files && previous.id===digest({schema:2,files:previous.files}) &&
    previous.archive?.name===RESOURCE_ARCHIVE && (await fs.stat(legacyPath).catch(()=>null))?.size===previous.archive.size &&
    await fileHash(legacyPath).catch(error=>{if(error.code==='ENOENT')return null;throw error;})===previous.archive.sha256;
  const task = path.join(root, '_tmp/resource-shards-20261028'); await fs.mkdir(task, { recursive: true });
  const stage = await fs.mkdtemp(path.join(task, 'prepare-'));
  const archives = {}, changedArchives = [], published = [];
  let recompressedFiles = 0, removedFiles = 0, preserve = false;
  try {
    for (const name of RESOURCE_ARCHIVES) {
      const subset = Object.fromEntries(Object.entries(files).filter(([, record]) => record.archive === name));
      const groupId = digest({ schema: 3, files: subset });
      const oldFiles = trustedPrevious ? Object.fromEntries(Object.entries(previous.files).filter(([, record]) => record.archive === name)) : {};
      const old = trustedPrevious ? previous.archives?.[name] : null;
      const current = path.join(destination, name);
      const reusable = old?.name === name && old.id === digest({ schema: 3, files: oldFiles }) &&
        (await fs.stat(current).catch(() => null))?.size === old.size && await fileHash(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; }) === old.sha256;
      if (reusable && old.id === groupId) { archives[name] = old; continue; }
      const seedFiles=reusable?oldFiles:legacyReusable?previous.files:{};
      const hasSeed=reusable || legacyReusable;
      const changed = Object.keys(subset).filter(file => !hasSeed || seedFiles[file]?.sha256 !== subset[file].sha256 || seedFiles[file]?.size !== subset[file].size);
      const removed = hasSeed ? Object.keys(seedFiles).filter(file => resourceArchiveFor(file)===name && !Object.hasOwn(subset,file)) : [];
      const pruned = hasSeed ? Object.keys(seedFiles).filter(file=>!Object.hasOwn(subset,file)) : [];
      const folder = path.join(stage, name); await fs.mkdir(folder);
      const target = path.join(folder, name);
      console.log('[Resources] ' + name + ': ' + changed.length + ' changed, ' + removed.length + ' removed');
      await compress(source, target, changed, reusable ? current : legacyReusable ? legacyPath : undefined,
        hasSeed ? [...pruned, ...changed.filter(file => Object.hasOwn(seedFiles, file))] : []);
      archives[name] = { name, id: groupId, size: (await fs.stat(target)).size, sha256: await fileHash(target) };
      changedArchives.push(name); recompressedFiles += changed.length; removedFiles += removed.length;
    }
    if (JSON.stringify(await resourceInventory(source)) !== JSON.stringify(inventory)) throw new Error('Resource source changed during compression; retry the build');
    const packages = Object.fromEntries([...new Set(Object.keys(files).filter(name => name.startsWith('packages/')).map(name => name.split('/')[1]))].map(name => [name + '.zip', 'packages/' + name + '/']));
    const manifest = { schema: 3, id, directories: [...new Set(Object.keys(files).map(name => name.split('/')[0]))], files, packages, archives };
    const changed = changedArchives.length > 0 || JSON.stringify(previous) !== JSON.stringify(manifest);
    if (changed) {
      await fs.mkdir(destination, { recursive: true });
      await fs.writeFile(path.join(stage, RESOURCE_MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
      // Publish as one recoverable build transaction; the manifest commits last.
      const backup = path.join(stage, 'previous'); await fs.mkdir(backup);
      try {
        for (const name of [...changedArchives, RESOURCE_MANIFEST]) {
          const target = path.join(destination, name), oldPath = path.join(backup, name);
          const exists = await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
          if (exists && (!exists.isFile() || exists.isSymbolicLink())) throw new Error('Invalid resource publication target: ' + name);
          if (exists) await fs.rename(target, oldPath);
          published.push({ name, backup: !!exists });
          await fs.rename(name === RESOURCE_MANIFEST ? path.join(stage, name) : path.join(stage, name, name), target);
        }
      } catch (error) {
        for (const item of published.reverse()) {
          try {
            await fs.unlink(path.join(destination, item.name)).catch(e => { if (e.code !== 'ENOENT') throw e; });
            if (item.backup) await fs.rename(path.join(backup, item.name), path.join(destination, item.name));
          } catch { preserve = true; }
        }
        if (preserve) console.error('[Resources] Recovery retained at ' + stage);
        throw error;
      }
    }
    return { changed, id, files: Object.keys(files).length, sourceBytes: Object.values(files).reduce((n, f) => n + f.size, 0),
      archiveBytes: Object.values(archives).reduce((n, archive) => n + archive.size, 0), archives, changedArchives,
      recompressedFiles, removedFiles, seconds: Number(((performance.now() - started) / 1000).toFixed(3)) };
  } finally {
    // This directory was created by mkdtemp directly under the verified task root.
    if (!preserve) { if (path.dirname(stage) !== task) throw new Error('Resource cleanup boundary mismatch'); await fs.rm(stage, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await prepareResourceBundle(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))));
}
