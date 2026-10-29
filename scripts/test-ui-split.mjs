import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { planUiSplit, uiPayloads, UI_PUBLIC_ARCHIVE, UI_VARIANT_ARCHIVES } from './split-ui-archives.mjs';
import { readUiSource } from './lib/ui-source.mjs';

async function fixture(version, texture = 'shared-texture') {
  const zip = new JSZip();
  zip.file('ui-que/console/texture.dds', texture);
  zip.file('ui-org/feedback/model.mdx', 'shared-feedback');
  zip.file('ui-que/framedef/ui/version.fdf', version);
  zip.file('ui-que/framedef/ui/common.fdf', 'identical-fdf-stays-versioned');
  return zip.generateAsync({ type: 'nodebuffer' });
}
const inputs = await Promise.all(['20', '30'].map(version => fixture(version)));
const split = await planUiSplit(inputs);
assert.deepEqual(split.counts, { public: 2, variants: [2, 2] });
const second = await planUiSplit(UI_VARIANT_ARCHIVES.map(name => split.outputs.get(name)), split.outputs.get(UI_PUBLIC_ARCHIVE));
for (const [name, bytes] of split.outputs) assert.deepEqual(second.outputs.get(name), bytes, 'Split must be byte-idempotent');
await assert.rejects(planUiSplit([inputs[0], await fixture('30', 'different-texture')]), /Non-FDF UI payload differs/);
const fdfPublic = new JSZip(); fdfPublic.file('common.fdf', 'wrong-place');
await assert.rejects(planUiSplit(inputs, await fdfPublic.generateAsync({ type: 'nodebuffer' })), /must not contain FDF/);
await assert.rejects(planUiSplit(UI_VARIANT_ARCHIVES.map(name => split.outputs.get(name))), /Public UI package is missing/);
const conflicting = new JSZip(); conflicting.file('ui-que/console/texture.dds', 'wrong-public-texture');
await assert.rejects(planUiSplit(inputs, await conflicting.generateAsync({ type: 'nodebuffer' })), /Public UI payload conflicts/);

const q = path.resolve('assets/quenching');
const sourceFiles = async name => new Map(await Promise.all(Object.values((await readUiSource(q, name)).files).filter(entry => !entry.dir).map(async entry => [entry.name, await entry.async('nodebuffer')])));
const publicFiles = await sourceFiles(UI_PUBLIC_ARCHIVE);
assert([...publicFiles.keys()].every(name => !/\.fdf$/i.test(name)));
const resultFile = path.resolve('_tmp/ui-split-20261028/result.json');
const report = await fs.readFile(resultFile, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
for (const name of UI_VARIANT_ARCHIVES) {
  const variants = await sourceFiles(name);
  assert([...variants.keys()].every(file => /\.fdf$/i.test(file)));
  if (report) {
    const original = await uiPayloads(await fs.readFile(path.join(report.backup, name)));
    const composed = new Map([...publicFiles, ...variants]);
    assert.deepEqual([...composed.keys()].sort(), [...original.keys()].sort());
    for (const [file, bytes] of original) assert.deepEqual(composed.get(file), bytes, `${name}: changed ${file}`);
  }
}
console.log('PASS: FDF-only variants, shared-only public assets, byte-identical idempotence, conflicts rejected and actual compositions match both original ZIPs when local backups exist.');
