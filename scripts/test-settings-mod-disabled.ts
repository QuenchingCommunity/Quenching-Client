import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const parent=path.resolve('_tmp/settings-toggle-20261107');await fs.ensureDir(parent);
const root = await fs.mkdtemp(path.join(parent, 'mod-off-'));
const fixture = { enabled: false, channel: 'retail', extractions: 0, assets: path.join(root, 'assets') };
(globalThis as any).__settingsOffFixture = fixture;
const result = await build({
  stdin: { contents: `export { reaxel_War3Settings } from './src/Renderer/hooks/useWar3Settings';
    export { applyBlightSettings } from './src/Main/services/blight-service';`, resolveDir: process.cwd(), loader: 'ts' },
  platform: 'node', format: 'cjs', packages: 'external', bundle: true, write: false,
  plugins: [{ name: 'settings-off-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^(reaxes)$|(?:game-channel|asset-sync)$/ }, args =>
      ({ path: args.path, namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ resolveDir: process.cwd(), contents:
      'const f=globalThis.__settingsOffFixture;' + (
        args.path === 'reaxes' ? `export const reaxel=(factory)=>{let instance;return ()=>{
          instance??=factory();return typeof instance==='function'?instance():instance;};};
          export const createReaxable=(store)=>({store,setState:(change)=>Object.assign(store,change)});`
        : args.path.endsWith('game-channel') ? `export const getSelectedGameFolder=()=>f.channel==='ptr'?'_ptr_':'_retail_';
          export const gameChannelFolder=(channel)=>channel==='ptr'?'_ptr_':'_retail_';
          export const getSelectedGameChannel=()=>f.channel;export const getChannelModEnabled=()=>f.enabled;`
        : `export const AssetSyncService={getAssetsDir:async()=>f.assets,extractZip:async(_zip,destination)=>{
          f.extractions++;await require('fs-extra').outputFile(require('path').join(destination,'blight','test.dds'),'blight');}};`
      ),
    }));
  } }],
});
const module = { exports: {} as any };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { reaxel_War3Settings, applyBlightSettings } = module.exports;
const writes: string[] = [];
let saved: any;
const api: Record<string, any> = {
  getVisionModules: async () => ({}),
  getConfig: async (key: string) => key === 'gameChannel' ? fixture.channel : saved,
  setConfig: async (key: string, value: any) => { if (key === 'modSettings') saved = { ...value }; },
  getBranchModStates: async () => ({ retail: { enabled: fixture.enabled }, ptr: { enabled: fixture.enabled } }),
  getInstalledModState: async () => null,
  getFullPackageStatus: async () => true,
  getAppPath: async () => root,
  pathExists: async () => false,
  detectWar3Version: async () => ({ source: 'local', useLegacyShaders: false }),
};
for (const name of ['updateBlightSettings', 'updateUISettings', 'syncUISettings', 'updateLightingSettings',
  'updateTerrainSettings', 'updateTreeSettings', 'updateWaterSettings', 'updateFoliageSettings',
  'updatePostProcessing', 'updatePostProcessingGlow', 'updateGlowSettings', 'syncVersionedShaders', 'syncAssets']) {
  api[name] = async () => { writes.push(name); return true; };
}
const previousWindow = (globalThis as any).window;
(globalThis as any).window = { electronAPI: api };
const originalLog = console.log;
console.log = () => undefined;
try {
  const settings = reaxel_War3Settings();
  saved = { ...settings.store.modSettings, terrain: 'retro', tree: 'short', water: 'transparent',
    graphicsSelection: 'hd', objectShader: false, postProcessing: true, postProcessingGlow: true,
    glow: true, foliage: false, modEnabled: true };
  await settings.loadModSettings(root);
  for (const key of ['terrain', 'tree', 'water', 'objectShader', 'postProcessing', 'postProcessingGlow', 'glow', 'foliage']) {
    assert.equal(settings.store.modSettings[key], saved[key], `${key}: keep preference while files are parked`);
  }
  assert.deepEqual(writes, [], 'opening settings while off must not sync UI or shaders');
  await settings.saveModSettings(root, { blight: false });
  assert.equal(saved.blight, false);
  assert.deepEqual(writes, [], 'independent blight toggle must also honor MOD off');
  await settings.saveModSettings(root, { ui: 'quenching', lighting: 'rpg', glow: false });
  assert.equal(saved.ui, 'quenching');
  assert.equal(saved.lighting, 'rpg');
  assert.deepEqual(writes, [], 'off preferences must not call resource writers');

  fixture.enabled = true;
  await settings.loadSettings(root);
  assert.equal(settings.store.isLoading, false, 'reading settings must release the button loading state');
  assert.deepEqual(writes, [], 'reading settings with MOD enabled must not sync shaders or UI either');
  fixture.enabled = false;

  const branch = path.join(root, '_retail_');
  const blight = path.join(branch, 'terrainart', 'blight', 'test.dds');
  await fs.outputFile(blight, 'keep before disabling');
  await applyBlightSettings(root, true);
  await applyBlightSettings(root, false);
  assert.equal(await fs.readFile(blight, 'utf8'), 'keep before disabling');
  assert.equal(fixture.extractions, 0, 'direct backend blight calls must honor the channel switch');
  fixture.enabled = true;
  const journal = path.join(branch, '.quenching', 'branch-toggle.json');
  await fs.outputJson(journal, { schema: 1, phase: 'disabled', moves: [] });
  await applyBlightSettings(root, false);
  assert.equal(await fs.readFile(blight, 'utf8'), 'keep before disabling', 'disk journal also prevents writes');
  await fs.remove(journal);
  await fs.outputFile(path.join(fixture.assets, 'quenching', 'zip-blight-que.zip'), 'mock archive');
  await applyBlightSettings(root, true);
  assert.equal(fixture.extractions, 1);
  assert.equal(await fs.readFile(blight, 'utf8'), 'blight');
  await applyBlightSettings(root, false);
  assert.equal(await fs.pathExists(blight), false, 'blight still toggles normally while MOD is on');
  fixture.enabled = false;
  fixture.channel = 'ptr';
  await fs.ensureDir(path.join(root, '_ptr_'));
  await applyBlightSettings(root, true);
  assert.equal(await fs.pathExists(path.join(root, '_ptr_', 'terrainart')), false);
} finally {
  console.log = originalLog;
  if (previousWindow === undefined) delete (globalThis as any).window;
  else (globalThis as any).window = previousWindow;
  delete (globalThis as any).__settingsOffFixture;
  await fs.remove(root);
}
console.log('PASS: MOD-off settings preserve preferences and never reactivate UI, lighting, shaders or blight');
