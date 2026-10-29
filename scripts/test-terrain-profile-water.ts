import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

await fs.ensureDir(path.resolve('_tmp/preset-timeout'));
const root = await fs.mkdtemp(path.join(path.resolve('_tmp/preset-timeout'), 'terrain-profile-'));
const fixture: any = { handlers: new Map(), assets: path.join(root, 'assets'), settings: {
  graphicsSelection: 'hd', versionSelection: 'v30', resolvedGraphics: 'de',
} };
(globalThis as any).__terrainProfileFixture = fixture;
try {
  const bundled = await build({
    stdin: { contents: 'export { registerTerrainHandlers } from "./src/Main/ipc/terrain-handlers";', resolveDir: process.cwd(), loader: 'ts' },
    platform: 'node', format: 'cjs', packages: 'external', bundle: true, write: false,
    plugins: [{ name: 'terrain-profile-fixture', setup(plugin) {
      plugin.onResolve({ filter: /^electron$|(?:game-channel|config-manager|asset-sync|full-package-service|foliage-service|war3-version|decisive-terrain-tree-textures)$/ },
        args => ({ path: args.path, namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
        'const f=globalThis.__terrainProfileFixture;' + (
          args.path === 'electron' ? 'export const ipcMain={handle:(name,fn)=>f.handlers.set(name,fn)};'
          : args.path.endsWith('game-channel') ? 'export const getSelectedGameFolder=()=>"_retail_";export const getSelectedGameChannel=()=>"retail";'
          : args.path.endsWith('config-manager') ? 'export const configManager={get:()=>f.settings};'
          : args.path.endsWith('asset-sync') ? 'export const AssetSyncService={getAssetsDir:async()=>f.assets};'
          : args.path.endsWith('full-package-service') ? 'export const assertTerrainModeAvailable=async()=>{};'
          : args.path.endsWith('foliage-service') ? 'export const syncFoliageForTerrainIfEnabled=async()=>{};'
          : args.path.endsWith('war3-version') ? 'export const detectWar3Version=async()=>({parts:[3,0,0,24268]});'
          : 'export const syncDecisiveTerrainTreeTextures=async()=>{};'
        ),
      }));
    } }],
  });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  module.exports.registerTerrainHandlers();
  const update = fixture.handlers.get('terrain:update-settings');
  const branch = path.join(root, '_retail_');
  const tile = path.join(fixture.assets, 'quenching', 'tile');
  for (const era of ['00', '16', '18', '20', '30']) {
    await fs.outputFile(path.join(tile, `clifftypes${era}.slk`), `cliff:${era}`);
    await fs.outputFile(path.join(tile, `terrain${era}.slk`), `terrain:${era}`);
  }
  await fs.outputFile(path.join(tile, 'water-trans.slk'), 'transparent-water');
  await fs.ensureDir(branch);
  const water = path.join(branch, 'terrainart', 'water.slk');
  for (const terrain of ['latest', 'v16', 'v18', 'retro']) {
    assert.equal(await update(null, root, terrain, 'transparent'), true);
    assert.equal(await fs.readFile(water, 'utf8'), 'transparent-water', `${terrain}: HD must not lose water due to old DE metadata`);
    await update(null, root, terrain, 'realistic');
    assert.equal(await fs.pathExists(water), false, `${terrain}: realistic water must use the native table`);
    await update(null, root, terrain, 'transparent');
    await update(null, root, terrain, 'off');
    assert.equal(await fs.pathExists(water), false, `${terrain}: original water must use the native table`);
  }
  for (const mode of ['realistic', 'off']) {
    await fs.outputFile(water, 'stale transparent table');
    await update(null, root, 'original', mode);
    assert.equal(await fs.pathExists(water), false, `original terrain with ${mode}: stale water table must be removed`);
  }
  // A DE selection on a 2.x version resolves to HD: use that actual profile.
  fixture.settings = { graphicsSelection: 'de', versionSelection: 'v204', resolvedGraphics: 'de' };
  await update(null, root, 'latest', 'transparent');
  assert.equal(await fs.readFile(water, 'utf8'), 'transparent-water');
  fixture.settings = { graphicsSelection: 'de', versionSelection: 'v30', resolvedGraphics: 'hd' };
  await fs.outputFile(path.join(branch, 't30', 'keep.txt'), 'client terrain vault');
  await fs.outputFile(path.join(branch, 't30', 'sample', 'terrain.dds'), 'decisive-tile');
  // Simulate the old direct-copy layout. Preserve unrelated native/custom paths.
  await fs.outputFile(path.join(branch, 'terrainart', 'sample', 'terrain.dds'), 'old-decisive-tile');
  await fs.outputFile(path.join(branch, 'terrainart', 'sample', 'untouched.dds'), 'native-tile');
  await update(null, root, 'decisive', 'transparent');
  assert.equal(await fs.pathExists(water), false, 'actual DE must not write the HD water SLK');
  assert.equal(await fs.readFile(path.join(branch, 'terrainart', 'terrain.slk'), 'utf8'), 'terrain:30');
  assert.equal(await fs.readFile(path.join(branch, 'terrainart', 'clifftypes.slk'), 'utf8'), 'cliff:30');
  assert.equal(await fs.pathExists(path.join(branch, 'terrainart', 'sample', 'terrain.dds')), false, 'old copied textures must not shadow native paths');
  assert.equal(await fs.readFile(path.join(branch, 't30', 'sample', 'terrain.dds'), 'utf8'), 'decisive-tile', 'SLK switching must leave source textures intact');
  assert.equal(await fs.readFile(path.join(branch, 'terrainart', 'sample', 'untouched.dds'), 'utf8'), 'native-tile');
  assert.equal(await fs.readFile(path.join(branch, 'terrainart', 'meta.que'), 'utf8'), '30');
  for (const [mode, era] of [['latest', '20'], ['v16', '16'], ['v18', '18'], ['retro', '00']]) {
    await update(null, root, mode, 'transparent');
    assert.equal(await fs.readFile(path.join(branch, 'terrainart', 'terrain.slk'), 'utf8'), `terrain:${era}`);
    assert.equal(await fs.readFile(path.join(branch, 'terrainart', 'clifftypes.slk'), 'utf8'), `cliff:${era}`);
    assert.equal(await fs.pathExists(water), false, `${mode}: DE keeps native water`);
  }
  await update(null, root, 'original');
  assert.equal(await fs.pathExists(path.join(branch, 'terrainart', 'terrain.slk')), false);
  assert.equal(await fs.pathExists(path.join(branch, 'terrainart', 'clifftypes.slk')), false);
  assert.equal(await fs.readFile(path.join(branch, 'terrainart', 'sample', 'untouched.dds'), 'utf8'), 'native-tile');
  console.log('PASS: HD/DE terrain choices and water, T30 SLK routing, legacy copied-texture cleanup and source/native preservation');
} finally {
  delete (globalThis as any).__terrainProfileFixture;
  await fs.remove(root);
}
