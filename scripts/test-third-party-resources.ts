import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs-extra';
import JSZip from 'jszip';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const compiled = await build({
  entryPoints: ['src/Main/services/third-party-resources.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'third-party-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^\.\/(game-channel|full-package-service)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('full-package-service')
      ? 'export const isFullPackageInstalled=async()=>false;'
      : 'export const getSelectedGameFolder=()=>"_retail_";export const getSelectedGameChannel=()=>"retail";export const getChannelModEnabled=()=>true;' }));
  } }],
});
const loaded = { exports: {} as any };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { getThirdPartyState, importThirdPartySource, peelToGamePaths, setThirdPartyEnabled, setThirdPartyFeature, setThirdPartyName } = loaded.exports;

assert.deepEqual(
  peelToGamePaths(['VisionMod/Install Guide.txt', 'VisionMod/_retail_/units/hero.mdx', 'VisionMod/_retail_/terrainart/terrain.slk']),
  ['units/hero.mdx', 'terrainart/terrain.slk']
);
assert.deepEqual(peelToGamePaths(['units/hero.mdx']), ['units/hero.mdx']);
assert.deepEqual(peelToGamePaths(['mycustom/readme.txt']), ['mycustom/readme.txt']);
assert.deepEqual(
  peelToGamePaths(['Pack/_retail_/t00/a.txt', 'Pack/_ptr_/t00/b.txt'], '_ptr_'),
  ['t00/b.txt']
);

const parent = path.resolve('_tmp/branch-startup-recovery-20261107');
await fs.ensureDir(parent);
const root = await fs.mkdtemp(path.join(parent, 'third-party-'));
const retail = path.join(root, '_retail_');
try {
  await fs.ensureDir(path.join(retail, 't00'));
  await fs.writeFile(path.join(retail, 't00', 'tile.txt'), 'quenching');
  await fs.ensureDir(path.join(retail, 'terrainart'));
  await fs.writeFile(path.join(retail, 'terrainart', 'terrain.slk'), 'slk');
  await fs.ensureDir(path.join(retail, 'shaders'));

  const empty = await getThirdPartyState(root);
  assert.equal(empty.slots[0].imported, false);
  assert.equal(empty.slots[0].name, 'Assets 1');
  await setThirdPartyName(root, 1, 'My campaign');
  assert.equal((await getThirdPartyState(root)).slots[0].name, 'My campaign');
  await assert.rejects(setThirdPartyEnabled(root, 1, true), /请先导入资源/);

  const source = path.join(root, 'incoming', 'VisionMod');
  await fs.ensureDir(path.join(source, '_retail_', 'units'));
  await fs.ensureDir(path.join(source, '_retail_', 'terrainart'));
  await fs.writeFile(path.join(source, 'Install Guide.txt'), 'ignore');
  await fs.writeFile(path.join(source, '_retail_', 'units', 'hero.mdx'), 'model');
  await fs.writeFile(path.join(source, '_retail_', 'terrainart', 'terrain.slk'), 'other');
  const imported = await importThirdPartySource(root, 1, { kind: 'directory', path: source });
  const slot = imported.slots[0];
  assert.equal(slot.imported, true);
  assert.equal(slot.enabled, false);
  assert.equal(await fs.pathExists(path.join(root, 'QM Assets 1', 'units', 'hero.mdx')), true);
  assert.equal(await fs.pathExists(path.join(retail, 'units', 'hero.mdx')), false);
  assert.equal(slot.features?.find(feature => feature.id === 'terrain')?.blocked, true);
  assert.equal(slot.features?.find(feature => feature.id === 'units')?.blocked, true);
  assert.equal(slot.features?.find(feature => feature.id === 'shaders')?.blocked, false);
  await assert.rejects(setThirdPartyFeature(root, 1, 'terrain', true), /冲突/);

  await setThirdPartyFeature(root, 1, 'shaders', false);
  await setThirdPartyEnabled(root, 1, true);
  assert.equal(await fs.pathExists(path.join(retail, 'units', 'hero.mdx')), true);
  assert.equal(await fs.pathExists(path.join(retail, 'QMoff', 'third-party', 'shaders')), true);
  assert.equal(await fs.pathExists(path.join(retail, 'shaders')), false);
  assert.equal(await fs.pathExists(path.join(root, 'QM Assets 1', 'units', 'hero.mdx')), true);

  await fs.writeFile(path.join(retail, 'units', 'hero.mdx'), 'player edited model');
  await fs.outputFile(path.join(retail, 'shaders', 'extra.bls'), 'player shader');
  await setThirdPartyEnabled(root, 1, false);
  assert.equal(await fs.pathExists(path.join(retail, 'units', 'hero.mdx')), false);
  assert.equal(await fs.pathExists(path.join(retail, 'shaders')), true);
  assert.equal(await fs.pathExists(path.join(retail, 't00', 'tile.txt')), true);
  const backupNames = await fs.readdir(path.join(root, '.quenching', 'player-file-backups'));
  const backup = path.join(root, '.quenching', 'player-file-backups', backupNames.find(name => name.startsWith('third-party-1-'))!);
  assert.equal(await fs.readFile(path.join(backup, 'modified', 'units', 'hero.mdx'), 'utf8'), 'player edited model');
  assert.equal(await fs.readFile(path.join(backup, '_leftovers', 'shaders', 'extra.bls'), 'utf8'), 'player shader');

  // A failed state commit must restore the active files and all parked originals.
  await setThirdPartyEnabled(root, 1, true);
  const originalRename = fs.rename;
  let injected = false;
  fs.rename = (async (from: string, to: string) => {
    if (!injected && from.endsWith('_QMThirdParty.json.tmp')) {
      injected = true; throw Error('injected third-party state failure');
    }
    return originalRename(from, to);
  }) as typeof fs.rename;
  try {
    await assert.rejects(setThirdPartyEnabled(root, 1, false), /injected third-party state failure/);
  } finally { fs.rename = originalRename; }
  assert.equal((await getThirdPartyState(root)).slots[0].enabled, true);
  assert.equal(await fs.readFile(path.join(retail, 'units/hero.mdx'), 'utf8'), 'model');
  assert.equal(await fs.pathExists(path.join(retail, 'QMoff/third-party/shaders')), true);
  await setThirdPartyEnabled(root, 1, false);

  const zip = new JSZip();
  zip.file('Outer/Install Guide.txt', 'ignore');
  zip.file('Outer/_ptr_/t16/cliff.txt', 'tile');
  const zipPath = path.join(root, 'pack.zip');
  await fs.writeFile(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));
  const fromZip = await importThirdPartySource(root, 2, { kind: 'zip', path: zipPath });
  assert.deepEqual(fromZip.slots[1].topLevel, ['t16']);
  assert.equal(fromZip.slots[1].features?.find(feature => feature.id === 'terrain')?.blocked, true);
  assert.equal(await fs.pathExists(path.join(root, 'QM Assets 2', 't16', 'cliff.txt')), true);
  assert.equal(await fs.pathExists(path.join(retail, 't16')), false);

  console.log('third-party resource smoke test passed');
} finally {
  await fs.remove(root);
  if (process.versions.electron) (await import('electron')).app.quit();
}
