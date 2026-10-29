import { resourcePath } from '../src/shared/bundled-resource-paths.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { parseSkinSections } from '../src/shared/skin-versions';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'quenching-destructable-skins-'));
const retail = path.join(root, '_retail_');
const ptr = path.join(root, '_ptr_');
const quenching = path.join(root, 'assets', 'quenching');
const fixture: any = { channel: 'retail', parts: [3, 0, 0], config: {}, handlers: {} };
(globalThis as any).__destructableFixture = fixture;
const mocks: Record<string, string> = {
  electron: 'export const app={getAppPath:()=>process.cwd()}; export const ipcMain={handle:(key,handler)=>f.handlers[key]=handler};',
  'config-manager': 'export const configManager={get:key=>f.config[key],set:(key,value)=>f.config[key]=value};',
  'game-channel': 'export const getSelectedGameChannel=()=>f.channel,getSelectedGameFolder=()=>f.channel==="ptr"?"_ptr_":"_retail_",getChannelModEnabled=()=>true,hasGameChannelDirectory=async()=>true;',
  'war3-version': 'export const detectWar3Version=async()=>({parts:f.parts,source:"fixture"});',
  'full-package-service': 'export const resolveRetailDir=async root=>root+"/"+(f.channel==="ptr"?"_ptr_":"_retail_"),isFullPackageInstalled=async()=>true,assertTreeModeAvailable=async()=>{};',
  'mod-integrity-service': 'export const readCurrentModVersion=async()=>"3.5";',
  'mod-update-service': 'export const getInstalledModState=async()=>null;',
  'third-party-resources': 'export const isThirdPartyQuenchingPaused=async()=>false,markKnownQuenching=async()=>{};',
  'dnc-lighting': 'export const applyDncLighting=async()=>{};',
  'fog-shader-override': 'export const applyShaderToggles=async()=>{}; export const applyIntelAmdBloomForProfile=async()=>{};',
  'graphics-layout-service': 'export const restoreSdParkedResources=async()=>{},restoreHdUnitsAndBuildings=async()=>{},parkNonHdUnitsAndBuildings=async()=>{},syncGraphicsLayout=async()=>({waterNeedsReapply:false});',
  'environment-layout-service': 'export const restoreHdPublicEnvironment=async()=>true,parkHdPublicEnvironment=async()=>{};',
  'post-processing-config': 'export const POST_PROCESSING_CONFIG_FILE="PostProcessingConfig.txt",copyPostProcessingConfigIfMissing=async()=>false,setPostProcessingAoEnabled=async()=>false;',
  'zip-extraction': 'export const extractZipArchive=async()=>({});',
  'webui-assets-service': 'export const syncClientWebUIFiles=async()=>{};',
  'war3-path': 'export const normalizeWar3RootPath=root=>root;',
  'ui-service': 'export const UIService={syncConfiguredUI:async()=>{}};',
  'water-handlers': 'export const applyWaterSettings=async()=>{};',
  'retro-skin-service': 'export const retroSkinService={apply:async()=>{}};',
};
const bundled = await build({
  stdin: { contents: `export { registerTreeHandlers } from './src/Main/ipc/tree-handlers';
    export { syncProfileResources } from './src/Main/services/asset-sync';`, resolveDir: process.cwd(), loader: 'ts' },
  platform: 'node', format: 'cjs', packages: 'external', bundle: true, write: false,
  plugins: [{ name: 'destructable-fixture', setup(plugin) {
    plugin.onResolve({ filter: /.*/ }, args => {
      if (args.path.includes('/shared/')) return;
      const name = args.path.split('/').at(-1)!;
      return mocks[name] ? { path: name, namespace: 'fixture' } : undefined;
    });
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
      contents: 'const f=globalThis.__destructableFixture;' + mocks[args.path],
    }));
  } }],
});
const module = { exports: {} as any };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { registerTreeHandlers, syncProfileResources } = module.exports;
const originalLog = console.log;
console.log = () => {};
const target = () => path.join(fixture.channel === 'ptr' ? ptr : retail, 'units', 'destructableskin.txt');
const read = (file: string) => fs.readFile(file, 'utf8');
const contents = async () => parseSkinSections(await read(target()));
try {
  await fs.ensureDir(retail);
  await fs.ensureDir(ptr);
  await fs.copy(path.resolve('assets/unpacked/skin'), resourcePath(quenching, 'skin'));
  for (const name of ['dnc/dnc20', 'dnc/dnc30-hd', 'dnc/dnc30-de', 'shaders/shaders203',
    'shaders/shaders-300-legacy-hd/vs', 'shaders/shaders-300-legacy-hd/ps/standard', 'shaders/shaders-300-legacy-de',
    'shaders/shaders-300-hd/vs', 'shaders/shaders-300-hd/ps/standard', 'shaders/shaders-300-de',
    'shaders/shaders-ptr-hd/vs', 'shaders/shaders-ptr-hd/ps/standard']) {
    await fs.outputFile(path.join(quenching, name, 'fixture-resource.txt'), name);
  }
  const baseline = await read(resourcePath(quenching, 'skin', 'destructableskin.txt'));
  const original = parseSkinSections(baseline);
  const shortOverrides: Array<{ section: string; field: string; value: string }> =
    (await fs.readJson(path.resolve('scripts/fixtures/destructable-short-overrides.json'))).overrides;
  assert.equal(shortOverrides.length, 39);
  const normalizedPath = (value: string) => value.replace(/\\/g, '/').toLowerCase();
  assert.equal(Object.keys(original).length, 348);
  assert.equal(original.YTsc, undefined);
  assert(original.Ytsc && original.UB01 && original.Dogw && original.YTpl);
  assert.match(original.BTsk.file, /LordaeronCityMainGateColumn/);
  assert.equal(original.Yts1.texFile, undefined);
  assert.match(original.Yts1['texFile:sd'], /LordaeronSummerTree/);
  for (const name of ['destructableskin-org.txt', 'destructableskin-de.txt']) {
    assert.equal(await read(resourcePath(quenching, 'skin', name)), baseline);
  }
  const legacy = parseSkinSections(await read(resourcePath(quenching, 'skin', 'legacy', 'destructableskin.txt')));
  assert.equal(Object.keys(legacy).length, 340);
  assert(legacy.YTsc && !legacy.Ytsc && !legacy.UB01);

  // Use the real IPC handler and automatic version resolver, not a template-only test.
  registerTreeHandlers();
  const choose = (tree: string) => fixture.handlers['tree:update-settings'](null, root, tree);
  fixture.config.modSettings = { versionSelection: 'auto', graphicsSelection: 'hd', tree: 'original' };
  await choose('original');
  assert.equal(await read(target()), baseline, '3.0 original restores its complete table');
  for (const [mode, folder] of [['tall', 't20'], ['short', 't20'], ['v18', 't18'], ['v16', 't16'], ['retro', 't00']]) {
    await choose(mode);
    const generated = await contents();
    assert.equal(Object.keys(generated).length, 348);
    assert.deepEqual(generated.UB01, original.UB01, 'tree replacement retains new non-tree destructables');
    assert.deepEqual(generated.Ytsc, original.Ytsc, 'new object IDs remain intact');
    assert.equal(generated.Yts1.texFile, undefined, 'do not introduce a shared field masking the new SD field');
    if (mode === 'retro') assert.equal(generated.Yts1['texFile:sd'], original.Yts1['texFile:sd']);
    else assert(generated.Yts1['texFile:sd'].includes(`/tree/${folder}/`));
    assert.equal(generated.BTsk.file, original.BTsk.file);
    if (mode === 'short') {
      // These expected edits come from the shipped QMF, not the tree writer.
      for (const { section, field, value } of shortOverrides) {
        const targetField = section === 'Yts1' && field === 'texFile' ? 'texFile:sd' : field;
        assert.equal(normalizedPath(generated[section][targetField]), normalizedPath(value),
          `3.0 must retain the QMF customization ${section}.${field}`);
      }
      for (const [section, fields] of Object.entries(original)) {
        for (const [field, value] of Object.entries(fields)) {
          const customized = shortOverrides.some(edit => edit.section === section &&
            (edit.field === field || (section === 'Yts1' && edit.field === 'texFile' && field === 'texFile:sd')));
          if (!customized) assert.equal(generated[section][field], value,
            `tree replacement must retain the 3.0 baseline field ${section}.${field}`);
        }
      }
    }
  }
  fixture.parts = [2, 0, 4];
  await choose('original');
  assert.equal(await read(target()), await read(resourcePath(quenching, 'skin', 'legacy', 'destructableskin.txt')));
  await choose('v16');
  assert.equal(Object.keys(await contents()).length, 340);
  assert((await contents()).Yts1.texFile.includes('/tree/t16/'));
  assert.equal((await contents()).Yts1['texFile:sd'], undefined);

  // Profile sync must replace an old table even when graphics remain HD, and keep the chosen trees.
  fixture.parts = [3, 0, 0];
  fixture.config.modSettings = { versionSelection: 'auto', graphicsSelection: 'hd', tree: 'v16', resolvedVersion: 'v204', resolvedGraphics: 'hd' };
  await syncProfileResources(root, quenching, fixture.config.modSettings);
  assert.equal(Object.keys(await contents()).length, 348);
  assert((await contents()).LTlt.file.includes('/d16/'));
  assert.equal(fixture.config.modSettings.resolvedVersion, 'v30');
  await fs.writeFile(target(), '[LTlt]\nfile=outdated-client-table\n');
  await syncProfileResources(root, quenching, fixture.config.modSettings);
  assert.equal(Object.keys(await contents()).length, 348, 'startup refreshes outdated tables');
  assert((await contents()).LTlt.file.includes('/d16/'), 'startup retains custom trees');
  fixture.parts = [2, 0, 4];
  await syncProfileResources(root, quenching, fixture.config.modSettings);
  assert.equal(Object.keys(await contents()).length, 340, 'switching back restores the 2.x table');
  fixture.parts = [3, 0, 0];
  fixture.config.modSettings.graphicsSelection = 'de';
  fixture.config.modSettings.tree = 'original';
  await syncProfileResources(root, quenching, fixture.config.modSettings);
  assert.equal(await read(target()), baseline, 'DE original uses the 3.0 table');
  fixture.config.modSettings.tree = 'v18';
  await syncProfileResources(root, quenching, fixture.config.modSettings);
  assert((await contents()).LTlt.file.includes('/d18/'), 'DE permits manually selected trees');
  const beforeSd = await read(target());
  fixture.config.modSettings.graphicsSelection = 'sd';
  await syncProfileResources(root, quenching, fixture.config.modSettings);
  assert.equal(await read(target()), beforeSd, 'SD skin-only sync does not install destructable overrides');

  fixture.channel = 'ptr';
  fixture.parts = [3, 0, 1, 24368];
  fixture.config.modSettings.graphicsSelection = 'hd';
  fixture.config.modSettings.tree = 'original';
  await syncProfileResources(root, quenching, fixture.config.modSettings);
  assert.equal(await read(target()), baseline);
  assert.equal(await read(path.join(retail, 'units', 'destructableskin.txt')), beforeSd, 'PTR sync leaves Retail untouched');
} finally {
  console.log = originalLog;
  delete (globalThis as any).__destructableFixture;
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.remove(root);
}
console.log('PASS: 2.x/3.0 destructable baselines, 39 shipped Quenching overrides, unchanged 3.0 fields, all tree variants, version/startup sync, DE originals/manual trees, SD skin-only and PTR isolation');
