import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import fs from 'fs-extra';
import JSZip from 'jszip';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const promises = require('node:fs/promises');
const realRm = promises.rm, realRename = fs.rename;
const parent = path.resolve('_tmp/foliage-delete-restore');
await fs.ensureDir(parent);
const root = await fs.mkdtemp(path.join(parent, 'test-'));
const fixture = { assets: path.join(root, 'assets'), settings: { foliage: true, terrain: 'v16' } };
(globalThis as any).__foliageSyncFixture = fixture;
const bundled = await build({ stdin: { contents: `export * from './src/Main/services/foliage-service';
  export * from './src/Main/services/environment-layout-service';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'foliage-fixture', setup(api) {
    api.onResolve({ filter: /(?:game-channel|asset-sync|config-manager)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    api.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: 'const f=globalThis.__foliageSyncFixture;' + (
      args.path.endsWith('game-channel') ? 'export const getSelectedGameFolder=()=>"_retail_";'
      : args.path.endsWith('asset-sync') ? 'export const AssetSyncService={getAssetsDir:async()=>f.assets};'
      : 'export const configManager={get:()=>f.settings,set:(_key,value)=>{f.settings=value;}};'
    ) }));
  } }] });
const module = { exports: {} as any };
new Function('require','module','exports',bundled.outputFiles[0].text)(require,module,module.exports);
const { applyFoliageSettings, parkHdPublicEnvironment, restoreHdPublicEnvironment, syncPublicEnvironmentFoliage } = module.exports;
const branch = path.join(root, 'game/_retail_');
const active = path.join(branch, 'environment/foliage');
const model = path.join(active, 'test/model.mdx');
const bundle = path.join(fixture.assets, 'quenching/zip-foliage-que.zip');
async function zip(name: string, text: string) {
  const archive = new JSZip(); archive.file('foliage/test/model.mdx', text); archive.file('foliage/test/中文.dds', 'texture');
  await fs.outputFile(path.join(fixture.assets, 'quenching', name), await archive.generateAsync({ type: 'nodebuffer' }));
}
try {
  await fs.ensureDir(branch);
  await zip('zip-foliage-other.zip', 'battle'); await zip('zip-foliage-que.zip', 'standard');
  fs.rename = (async (from: string, to: string) => {
    assert.notEqual(from, active, 'the active foliage directory must never be renamed');
    return realRename(from, to);
  }) as typeof fs.rename;
  await applyFoliageSettings(path.dirname(branch), true, 'v16');
  await fs.outputFile(path.join(active, 'obsolete.txt'), 'old variant');
  const progress: number[] = [];
  await applyFoliageSettings(path.dirname(branch), true, 'latest', (p: number) => {
    progress.push(p);
    if (p === 5) assert(!fs.existsSync(active), 'deletion finishes before extraction starts');
  });
  assert.equal(await fs.readFile(model, 'utf8'), 'standard');
  assert(!await fs.pathExists(path.join(active, 'obsolete.txt')));
  assert.equal(progress.at(-1), 100);
  await fs.writeFile(model, 'damaged existing file');
  await applyFoliageSettings(path.dirname(branch), true, 'latest');
  assert.equal(await fs.readFile(model, 'utf8'), 'standard', 'reapplying the same source extracts a fresh copy');
  assert(!await fs.pathExists(path.join(active, '.quenching-foliage-source.json')));

  promises.rm = async (file: string, options: any) => {
    if (file === active) throw Object.assign(new Error('fixture deletion blocked'), { code: 'EBUSY' });
    return realRm(file, options);
  };
  const failedProgress: number[] = [];
  try { await assert.rejects(applyFoliageSettings(path.dirname(branch), true, 'v16', (p: number) => failedProgress.push(p)), /deletion blocked/); }
  finally { promises.rm = realRm; }
  assert.equal(await fs.readFile(model, 'utf8'), 'standard');
  assert(!failedProgress.includes(5), 'do not start extraction after failed deletion');
  assert(!failedProgress.includes(100));

  await realRename(bundle, bundle + '.missing');
  try { await assert.rejects(applyFoliageSettings(path.dirname(branch), true, 'latest'), /not found/); }
  finally { await realRename(bundle + '.missing', bundle); }
  assert.equal(await fs.readFile(model, 'utf8'), 'standard', 'missing source is rejected before deleting foliage');
  await fs.writeFile(bundle, 'broken archive');
  await assert.rejects(applyFoliageSettings(path.dirname(branch), true, 'latest'));
  assert(!await fs.pathExists(active), 'delete-then-extract does not keep the previous variant after a corrupt extraction');
  await zip('zip-foliage-que.zip', 'standard');
  await Promise.all(['v16', 'latest', 'v16', 'latest'].map(mode => applyFoliageSettings(path.dirname(branch), true, mode)));
  assert.equal(await fs.readFile(model, 'utf8'), 'standard', 'concurrent requests retain FIFO order');

  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  promises.rm = async (file: string, options: any) => {
    if (file === active) { entered(); await gate; }
    return realRm(file, options);
  };
  const switching = applyFoliageSettings(path.dirname(branch), true, 'v16');
  await started;
  let parked = false;
  const parking = parkHdPublicEnvironment(branch).then(() => { parked = true; });
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(parked, false, 'environment parking waits for delete and extraction to finish');
    release(); await switching; await parking;
  } finally { release(); promises.rm = realRm; }
  await restoreHdPublicEnvironment(branch);
  assert.equal(await fs.readFile(model, 'utf8'), 'battle');
  await applyFoliageSettings(path.dirname(branch), false, 'latest');
  assert(!await fs.pathExists(active));
  assert.deepEqual(await fs.readdir(path.join(branch, '_tmp')), []);
  const sourceDir = path.join(fixture.assets, 'quenching');
  for (const terrain of ['latest', 'decisive', 'v30', 't30', 'original', 'classic', 'v16', 'v20']) {
    await syncPublicEnvironmentFoliage(branch, sourceDir, { foliage: true, terrain }, true);
    const que = ['latest', 'decisive', 'v30', 't30'].includes(terrain);
    assert.equal(await fs.readFile(model, 'utf8'), que ? 'standard' : 'battle', `Public environment foliage for ${terrain}`);
  }
  await syncPublicEnvironmentFoliage(branch, sourceDir, {}, true);
  assert.equal(await fs.readFile(model, 'utf8'), 'standard', 'Missing terrain/foliage settings retain enabled latest defaults');
  await fs.writeFile(model, 'retain-on-lighting-only-change');
  await syncPublicEnvironmentFoliage(branch, sourceDir, {}, false);
  assert.equal(await fs.readFile(model, 'utf8'), 'retain-on-lighting-only-change');
  await fs.remove(active);
  await syncPublicEnvironmentFoliage(branch, sourceDir, {}, false);
  assert.equal(await fs.readFile(model, 'utf8'), 'standard', 'Existing public marker must not conceal missing split foliage');
  await realRename(bundle, bundle + '.missing');
  try {
    await assert.rejects(syncPublicEnvironmentFoliage(branch, sourceDir, {}, true), /not found/);
    assert.equal(await fs.readFile(model, 'utf8'), 'standard', 'Missing split ZIP retains active foliage');
    await syncPublicEnvironmentFoliage(branch, sourceDir, { foliage: false }, true);
    assert(!await fs.pathExists(active), 'Disabled foliage needs no ZIP');
  } finally { await realRename(bundle + '.missing', bundle); }
  await syncPublicEnvironmentFoliage(branch, sourceDir, {}, true);
  await syncPublicEnvironmentFoliage(branch, sourceDir, { foliage: true, terrain: 'retro' }, true);
  assert(!await fs.pathExists(active), 'Public environment never reinstalls retro foliage');
  console.log('PASS: split public-environment foliage selection, missing-directory repair, disabled/retro handling, missing ZIP protection and lighting-only no-op.');
  console.log('PASS: delete-before-extract, fresh repeated extraction, no active-directory rename, deletion failure stops extraction, missing/corrupt source handling, progress, FIFO, environment coordination and disable.');
  if (process.argv.includes('--real')) {
    fixture.assets = path.resolve('assets');
    await applyFoliageSettings(path.dirname(branch), true, 'v16');
    const start = performance.now(); await applyFoliageSettings(path.dirname(branch), true, 'latest');
    console.log(JSON.stringify({ realDeleteThenExtractMs: Math.round(performance.now() - start) }));
  }
} finally {
  promises.rm = realRm; fs.rename = realRename;
  await fs.remove(root); delete (globalThis as any).__foliageSyncFixture;
}
