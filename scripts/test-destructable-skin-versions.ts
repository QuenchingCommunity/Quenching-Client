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
  // 该用例只测试皮肤表，隔离 Electron 和随资源同步加载的其他功能。
  electron: 'export const app={getAppPath:()=>process.cwd()}; export const ipcMain={handle:(key,handler)=>f.handlers[key]=handler}; export const nativeImage={};',
  'config-manager': 'export const configManager={get:key=>f.config[key],set:(key,value)=>f.config[key]=value};',
  'game-channel': 'export const getSelectedGameChannel=()=>f.channel,getSelectedGameFolder=()=>f.channel==="ptr"?"_ptr_":"_retail_",getChannelModEnabled=()=>true,hasGameChannelDirectory=async()=>true;',
  'war3-version': 'export const detectWar3Version=async()=>({parts:f.parts,source:"fixture"});',
  'full-package-service': 'export const resolveRetailDir=async root=>root+"/"+(f.channel==="ptr"?"_ptr_":"_retail_"),isFullPackageInstalled=async()=>true,assertFullPackageInstalled=async()=>{},assertTreeModeAvailable=async()=>{};',
  'mod-integrity-service': 'export const readCurrentModVersion=async()=>"3.5";',
  'mod-update-service': 'export const getInstalledModState=async()=>null;',
  'third-party-resources': 'export const isThirdPartyQuenchingPaused=async()=>false,markKnownQuenching=async()=>{};',
  'dnc-lighting': 'export const applyDncLighting=async()=>{},renderDncLighting=source=>source;',
  'fog-shader-override': 'export const applyShaderToggles=async()=>{},applyIntelAmdBloomForProfile=async()=>{},shaderToggleResourcePaths=()=>[],HDR_SHADER_FILES=[],supportsHdr=()=>false;',
  'graphics-layout-service': 'export const restoreSdParkedResources=async()=>{},restoreHdUnitsAndBuildings=async()=>{},parkNonHdUnitsAndBuildings=async()=>{},syncGraphicsLayout=async()=>({waterNeedsReapply:false});',
  'environment-layout-service': 'export const restoreHdPublicEnvironment=async()=>true,parkHdPublicEnvironment=async()=>{};',
  'foliage-service': 'export const syncPublicEnvironmentFoliage=async()=>{};',
  'post-processing-config': 'export const POST_PROCESSING_CONFIG_FILE="PostProcessingConfig.txt",applyPostProcessingConfigTemplate=async()=>false;',
  'zip-extraction': 'export const extractZipArchive=async()=>({}),getZipUncompressedBytes=async()=>0;',
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
  const oldV18 = await contents();
  assert(oldV18.LTlt.file.includes('/d18/'), 'DE permits manually selected trees');
  assert.equal(oldV18.BTtc['file:hd'], original.BTtc['file:hd'], '旧 MOD 继续使用原版 HD canopy');
  assert.equal(oldV18.BTtc['numVar:hd'], '0');

  // 模拟完整安装新资源，再从真实 DE 基准表启用这四组模型。
  const newTrees = [
    ['BTtw', 'BarrensTree/BarrensTree', 'BarrensTree/QuenchingBarrensTree', '10', '33'],
    ['ATtc', 'AshenCanopyTree/AshenCanopyTree', 'AshenvaleTree/QuenchingAshenCanopyTree', '3', '32'],
    ['CTtc', 'FelwoodCanopyTree/FelwoodCanopyTree', 'AshenvaleTree/QuenchingFelwoodCanopyTree', '3', '32'],
    ['BTtc', 'BarrensCanopyTree/BarrensCanopyTree', 'BarrensTree/QuenchingBarrensCanopyTree', '3', '32'],
  ];
  // 提供选择器要求的文件名，皮肤表测试不读取模型或图集文件内容。
  async function installTreeFixtures(trees: string[][]) {
    for (const [, model, texture, count] of trees) {
      for (let i = 0; i < Number(count); i++) {
        await fs.outputFile(path.join(retail, `doodads/que/d18/${model}${i}.mdx`), 'fixture');
      }
      for (const variant of ['', 'blight']) {
        for (const role of ['diffuse', 'normal', 'orm']) {
          await fs.outputFile(path.join(retail, `replaceabletextures/tree/t18/${texture}${variant}_${role}.dds`), 'fixture');
        }
      }
    }
  }
  await installTreeFixtures(newTrees);
  await choose('v18');
  const deV18 = await contents();
  for (const [id, model, texture, count, texId] of newTrees) {
    assert.equal(deV18[id].file, `Doodads/que/d18/${model}`);
    assert.equal(deV18[id].texFile, `ReplaceableTextures/tree/t18/${texture}`);
    assert.equal(deV18[id].numVar, count);
    assert.equal(deV18[id].texID, texId);
  }
  assert.equal(deV18.BTtc['file:hd'], deV18.BTtc.file);
  assert.equal(deV18.BTtc['numVar:hd'], deV18.BTtc.numVar);
  await choose('v16');
  const deV16 = await contents();
  assert.equal(deV16.BTtc['file:hd'], original.BTtc['file:hd']);
  assert.equal(deV16.BTtc['numVar:hd'], '0');
  for (const [id] of newTrees) assert.equal(deV16[id].file, original[id].file);

  // D16 圆冠树必须具备每个变体的站立、死亡伴随模型和三个季节的正常、腐地图集。
  const cityscapeSeasons = { YTct: '', YTwt: 'w', YTft: 'a' };
  for (let i = 0; i < 3; i++) {
    for (const state of ['', 'd', 's']) {
      await fs.outputFile(path.join(retail, `doodads/que/d16/Citytree${i}${state}.mdx`), 'fixture');
    }
  }
  for (const season of Object.values(cityscapeSeasons)) {
    for (const variant of ['', 'blight']) {
      for (const role of ['diffuse', 'normal', 'orm']) {
        await fs.outputFile(path.join(retail, `replaceabletextures/tree/t16/CityscapeTree/QuenchingCityscapeTree${season}${variant}_${role}.dds`), 'fixture');
      }
    }
  }
  const missingCityscape = path.join(retail, 'doodads/que/d16/Citytree2d.mdx');
  await fs.unlink(missingCityscape);
  await choose('v16');
  for (const id of Object.keys(cityscapeSeasons)) assert.deepEqual((await contents())[id], deV16[id]);
  await fs.writeFile(missingCityscape, 'fixture');
  await choose('v16');
  const d16Cityscape = await contents();
  for (const [id, season] of Object.entries(cityscapeSeasons)) {
    assert.equal(d16Cityscape[id].file, 'Doodads/que/d16/Citytree');
    assert.equal(d16Cityscape[id].texFile, `ReplaceableTextures/tree/t16/CityscapeTree/QuenchingCityscapeTree${season}`);
    assert.equal(d16Cityscape[id].numVar, '3');
    assert.equal(d16Cityscape[id].texID, '31');
  }
  await choose('v18');
  const restoredD18 = await contents();
  for (const id of Object.keys(cityscapeSeasons)) assert.deepEqual(restoredD18[id], deV18[id]);
  assert.deepEqual(restoredD18.YTst, original.YTst);

  // 即使旧版自定义冬季模型仍在本地，HD 配置也应重新使用原版诺森德和冰冠对象。
  const winterTrees = [
    ['NTtw', 'NorthrendTree/NorthrendTree', 'NorthrendTree/QuenchingNorthrendTree', '10', '34'],
    ['ITtw', 'IcecrownTree/IcecrownTree', 'AshenvaleTree/QuenchingIcecrownTree', '10', '32'],
  ];
  await installTreeFixtures(winterTrees);
  fixture.config.modSettings.graphicsSelection = 'hd';
  await choose('v18');
  for (const [id] of winterTrees) assert.deepEqual((await contents())[id], original[id]);

  // 第四套雪地图集齐备后，D18 和 D16 分别在 HD 和 DE 使用同样的四季圆冠资源。
  for (const variant of ['', 'blight']) {
    for (const role of ['diffuse', 'normal', 'orm']) {
      await fs.outputFile(path.join(retail, `replaceabletextures/tree/t16/CityscapeTree/QuenchingCityscapeTreeSnow${variant}_${role}.dds`), 'fixture');
    }
  }
  await choose('v18');
  const modernD18 = await contents();
  const fourSeasons = { ...cityscapeSeasons, YTst: 'Snow' };
  for (const [id, season] of Object.entries(fourSeasons)) {
    assert.deepEqual(modernD18[id], {
      ...original[id],
      file: 'Doodads/que/d16/Citytree',
      texFile: `ReplaceableTextures/tree/t16/CityscapeTree/QuenchingCityscapeTree${season}`,
      numVar: '3',
    });
  }
  assert.deepEqual(modernD18.WTst, restoredD18.WTst);
  assert.equal(modernD18.WTst.file, 'Doodads/que/d18/LordaeronTree/LordaeronTree');
  assert.equal(modernD18.WTst.texFile, 'ReplaceableTextures/tree/t18/LordaeronTree/LordaeronSnowTree');
  fixture.config.modSettings.graphicsSelection = 'de';
  await choose('v16');
  const modernD16 = await contents();
  for (const id of Object.keys(fourSeasons)) assert.deepEqual(modernD16[id], modernD18[id]);
  fixture.config.modSettings.tree = 'v18';
  await syncProfileResources(root, quenching, fixture.config.modSettings);
  const syncedD18 = await contents();
  for (const id of Object.keys(fourSeasons)) assert.deepEqual(syncedD18[id], modernD18[id]);
  for (const [id] of winterTrees) assert.deepEqual(syncedD18[id], original[id]);
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
