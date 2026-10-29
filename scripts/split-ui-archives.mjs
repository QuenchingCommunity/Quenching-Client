import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

export const UI_PUBLIC_ARCHIVE = 'zip-ui-pub.zip';
export const UI_VARIANT_ARCHIVES = ['zip-ui-20.zip', 'zip-ui-30.zip'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const isFdf = name => /\.fdf$/i.test(name);

export async function uiPayloads(bytes) {
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const result = new Map();
  for (const entry of Object.values(archive.files)) {
    if (entry.dir) continue;
    const name = entry.name;
    assert(!name.includes('\\') && !name.split('/').some(part => !part || part === '.' || part === '..'), `Unsafe UI path: ${name}`);
    result.set(name, await entry.async('nodebuffer'));
  }
  return result;
}

function samePayloads(left, right) {
  return left.size === right.size && [...left].every(([name, bytes]) => right.get(name)?.equals(bytes));
}

async function encode(files) {
  const archive = new JSZip();
  for (const name of [...files.keys()].sort()) archive.file(name, files.get(name), {
    date: new Date('1980-01-01T00:00:00Z'), createFolders: false,
  });
  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** Pure plan: preserve every payload, refuse to discard version-specific non-FDF files. */
export async function planUiSplit(inputs, existingPublic) {
  const variants = await Promise.all(inputs.map(uiPayloads));
  const originalPublic = existingPublic ? await uiPayloads(existingPublic) : new Map();
  assert([...originalPublic.keys()].every(name => !isFdf(name)), 'Public UI package must not contain FDF');
  const shared = new Map(originalPublic);
  const nonFdf = new Set(variants.flatMap(files => [...files.keys()].filter(name => !isFdf(name))));
  for (const name of nonFdf) {
    const bytes = variants[0].get(name);
    assert(bytes && variants.every(files => files.get(name)?.equals(bytes)), `Non-FDF UI payload differs: ${name}`);
    assert(!shared.has(name) || shared.get(name).equals(bytes), `Public UI payload conflicts: ${name}`);
    shared.set(name, bytes);
  }
  assert(shared.size > 0, 'Public UI package is missing');
  const fdfs = variants.map(files => new Map([...files].filter(([name]) => isFdf(name))));
  assert(fdfs.every(files => files.size > 0), 'Each UI variant must contain its FDF files');
  const outputs = new Map();
  outputs.set(UI_PUBLIC_ARCHIVE, existingPublic && samePayloads(shared, originalPublic) ? existingPublic : await encode(shared));
  for (let i = 0; i < UI_VARIANT_ARCHIVES.length; i++) {
    const composed = new Map([...shared, ...fdfs[i]]);
    assert(samePayloads(composed, new Map([...originalPublic, ...variants[i]])), 'Split changed composed UI payloads');
    outputs.set(UI_VARIANT_ARCHIVES[i], samePayloads(fdfs[i], variants[i]) ? inputs[i] : await encode(fdfs[i]));
  }
  return { outputs, counts: { public: shared.size, variants: fdfs.map(files => files.size) } };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const assets = path.join(root, 'assets/quenching');
  const original = new Map();
  for (const name of [...UI_VARIANT_ARCHIVES, UI_PUBLIC_ARCHIVE]) {
    const bytes = await fs.readFile(path.join(assets, name)).catch(error => {
      if (name === UI_PUBLIC_ARCHIVE && error.code === 'ENOENT') return null;
      throw error;
    });
    if (bytes) original.set(name, bytes);
  }
  const { outputs, counts } = await planUiSplit(UI_VARIANT_ARCHIVES.map(name => original.get(name)), original.get(UI_PUBLIC_ARCHIVE));
  const changed = [...outputs].filter(([name, bytes]) => !original.get(name)?.equals(bytes));
  if (!changed.length) { console.log(JSON.stringify({ changed: false, counts })); return; }
  const transaction = path.join(root, '_tmp/ui-split-20261028', `transaction-${Date.now()}`);
  await fs.mkdir(path.join(transaction, 'originals'), { recursive: true });
  await fs.mkdir(path.join(transaction, 'prepared'));
  for (const [name, bytes] of original) await fs.writeFile(path.join(transaction, 'originals', name), bytes, { flag: 'wx' });
  for (const [name, bytes] of changed) await fs.writeFile(path.join(transaction, 'prepared', name), bytes, { flag: 'wx' });
  const completed = [];
  try {
    for (const [name] of changed) {
      await fs.rename(path.join(transaction, 'prepared', name), path.join(assets, name));
      completed.push(name);
    }
  } catch (error) {
    for (const name of completed.reverse()) {
      if (original.has(name)) {
        const restored = path.join(transaction, 'prepared', name);
        await fs.writeFile(restored, original.get(name));
        await fs.rename(restored, path.join(assets, name));
      } else await fs.unlink(path.join(assets, name));
    }
    throw error;
  }
  const report = { changed: true, counts, backup: path.join(transaction, 'originals'),
    before: [...original].map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: hash(bytes) })),
    after: [...outputs].map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: hash(bytes) })),
    composedPayloadsUnchanged: true };
  await fs.writeFile(path.join(root, '_tmp/ui-split-20261028/result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
