// Explicit one-time intake. Normal launch/build flows consume the expanded source.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { fileHash } from './prepare-resource-bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacy = path.join(root, 'assets/quenching');
const source = path.join(root, 'assets/unpacked');
const report = [];
for (const name of (await fs.readdir(legacy)).filter(name => name.endsWith('.zip') && !['shaders.zip', 'shaders-300-legacy.zip'].includes(name))) {
  const packageRoot = path.join(source, 'packages', name.slice(0, -4));
  const archive = await JSZip.loadAsync(await fs.readFile(path.join(legacy, name)), { checkCRC32: true });
  let count = 0, bytes = 0;
  for (const entry of Object.values(archive.files)) {
    if (entry.dir) continue;
    const relative = entry.name.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '');
    if (relative.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) throw new Error(`Unsafe entry: ${entry.name}`);
    const file = path.join(packageRoot, relative), data = await entry.async('nodebuffer');
    const previous = await fs.readFile(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (previous && !previous.equals(data)) throw new Error(`Expanded resource differs; refusing to overwrite ${file}`);
    if (!previous) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, data, { flag: 'wx' }); }
    count++; bytes += data.length;
  }
  report.push({ name, files: count, expandedBytes: bytes, originalSha256: await fileHash(path.join(legacy, name)) });
}
await fs.mkdir(path.join(root, '_tmp/resource-bundle-20261028'), { recursive: true });
await fs.writeFile(path.join(root, '_tmp/resource-bundle-20261028/package-migration.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
