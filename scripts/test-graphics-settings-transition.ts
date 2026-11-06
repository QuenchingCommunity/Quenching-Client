import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderingPresetSettings, matchesRenderingPreset } from '../src/shared/rendering-presets';

const fixture: any = { category: 'game', enabled: true, failSync: false, fullPackage: true, syncs: 0, writes: [], treeRequests: [] };
(globalThis as any).__graphicsSettingsFixture = fixture;
const bundled = await build({
  stdin: { contents: `export { reaxel_War3Settings } from './src/Renderer/hooks/useWar3Settings';
    export { SettingsModal } from './src/Renderer/components/MainWindow/SettingsModal';`, resolveDir: process.cwd(), loader: 'ts' },
  platform: 'node', format: 'cjs', packages: 'external', bundle: true, write: false,
  plugins: [{ name: 'graphics-settings-fixture', setup(plugin) {
    plugin.onLoad({filter:/\.less$/},()=>({contents:'',loader:'text'}));
    plugin.onResolve({ filter: /^reaxes$|^antd$|^react$|(?:useWar3Settings|useWar3Detector|useSound|GlobalLoadingProvider|OverlayModal|i18n)$/ }, args => {
      if (args.namespace === 'fixture' && args.path === 'react') return { path: args.path, external: true };
      if (args.path.endsWith('useWar3Settings') && !args.importer.endsWith('SettingsModal.tsx')) return;
      return { path: args.path, namespace: 'fixture' };
    });
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ resolveDir: process.cwd(), contents:
      'const f=globalThis.__graphicsSettingsFixture;' + (
        args.path === 'reaxes' ? `export const reaxel=(factory)=>{let instance;return ()=>{
          instance??=factory();return typeof instance==='function'?instance():instance;};};
          export const createReaxable=(store)=>({store,setState:(change)=>Object.assign(store,change)});`
        : args.path === 'react' ? `const React=require('react');export default React;
          export const useState=(initial)=>React.useState(initial==='graphics'?f.category:initial);
          export const useEffect=React.useEffect;export const useMemo=React.useMemo;`
        : args.path === 'antd' ? `const React=require('react');const layout=({children})=>React.createElement('div',null,children);
          export const Button=({children,disabled})=>React.createElement('button',{disabled},children);
          export const Row=({children,className})=>React.createElement('div',{className},children);
          export const Col=({children,span})=>React.createElement('div',{'data-span':span},children);
          export const Space=layout,Spin=layout,Typography={Text:layout};
          export const Slider=({min,max,value})=>React.createElement('input',{type:'range',min,max,value,readOnly:true});
          export const InputNumber=({min,max,value})=>React.createElement('input',{type:'number',min,max,value,readOnly:true});
          export const message={error(){},success(){},warning(){}};`
        : args.path.endsWith('useWar3Settings') ? `export const useWar3Settings=()=>({modSettings:f.hook.store.modSettings,
          settings:f.hook.store.settings,saveModSettings:f.hook.saveModSettings,toggleGameMode(){},isLoading:f.hook.store.isLoading});`
        : args.path.endsWith('useWar3Detector') ? `export const useWar3Detector=()=>({currentInstallation:{path:'Z:/fixture-game'},detectInstallations:async()=>{}});`
        : args.path.endsWith('useSound') ? `export const useSound=()=>({playSmall(){},playHover(){}});`
        : args.path.endsWith('GlobalLoadingProvider') ? `export const useGlobalLoading=()=>({showLoading(){},hideLoading(){}});`
        : args.path.endsWith('OverlayModal') ? `export const OverlayModal=({children})=>children;`
        : `export const useTranslation=()=>({t:(key)=>key});`
      ),
    }));
  } }],
});
const module = { exports: {} as any };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { SettingsModal, reaxel_War3Settings } = module.exports;
fixture.hook = reaxel_War3Settings();
const hook = fixture.hook;
fixture.saved = { ...hook.store.modSettings, terrain: 'latest', resolvedGraphics: 'hd', resolvedVersion: 'v30' };
hook.store.modSettings = { ...fixture.saved };
let preferences = '[video]\nhd=1\n';
let terrainMeta = '20';
let treeContent = '';
const api = {
  getConfig: async (key: string) => key === 'gameChannel' ? 'retail' : { ...fixture.saved },
  setConfig: async (key: string, value: any) => { if (key === 'modSettings') fixture.saved = { ...value }; },
  getVisionModules: async () => ({}),
  getInstalledModState: async () => null,
  getFullPackageStatus: async () => fixture.fullPackage,
  getBranchModStates: async () => ({ retail: { enabled: fixture.enabled } }),
  getAppPath: async () => 'Z:/fixture-documents',
  pathExists: async (name: string) => /War3Preferences\.txt$|_retail_$|terrainart\/meta\.que$|units\/destructableskin\.txt$|environment\/foliage$|shaders\/ps\/(hd|fog|bloomextract)\.bls$/.test(name),
  readFile: async (name: string) => name.endsWith('destructableskin.txt') ? treeContent : name.endsWith('meta.que') ? terrainMeta : preferences,
  copyFile: async () => {},
  writeFile: async (_name: string, content: string) => { preferences = content; },
  syncAssets: async () => {
    fixture.syncs++;
    if (fixture.failSync) throw new Error('fixture missing profile assets');
    fixture.saved = { ...fixture.saved, resolvedGraphics: fixture.saved.graphicsSelection, resolvedVersion: 'v30' };
    if (fixture.saved.graphicsSelection !== 'sd') {
      await api.updateTreeSettings('Z:/fixture-game', fixture.saved.tree);
    }
  },
  updateTerrainSettings: async (_path: string, terrain: string, _water?: string, _previous?: string, requestId?: string) => {
    fixture.writes.push(`terrain:${terrain}`);
    fixture.lastTerrainRequest = requestId;
    if (fixture.delayTerrain) {
      const emit = (percent: number, id = requestId) => window.dispatchEvent(new CustomEvent('mod-profile-progress', {
        detail: { operation: 'terrain', requestId: id, step: 'environment', percent },
      }));
      emit(100, 'stale-terrain-request');
      emit(20);
      await new Promise(resolve => { fixture.releaseTerrain = resolve; });
      emit(100);
    }
    terrainMeta = ({ original: 'original', latest: '20', v16: '16', v18: '18', retro: '00', decisive: '30' } as any)[terrain];
    return true;
  },
  updateTreeSettings: async (_path: string, tree: string) => {
    fixture.writes.push('trees');
    fixture.treeRequests.push(tree);
    treeContent = tree === 'tall' ? 'tree/t20/LordaeronTree' : tree === 'v16' ? 'tree/t16/LordaeronTree' : 'Trees/LordaeronTree';
    return true;
  },
  updateWaterSettings: async () => { fixture.writes.push('water'); return true; },
  updateUISettings: async () => true,
  updateBlightSettings: async () => true,
  updateRotatingLighting: async (_path: string, enabled: boolean) => {
    fixture.writes.push('rotating-lighting');
    if (fixture.failRotating) throw new Error('fixture rotating lighting failed');
    fixture.saved = { ...fixture.saved, rotatingLighting: enabled };
    return true;
  },
  updateLightingAngle: async (_path: string, angle: number) => {
    fixture.writes.push('lighting-angle');
    if(fixture.failAngle)throw new Error('fixture angle failed');
    fixture.saved={...fixture.saved,lightingAngle:angle};return true;
  },
  updateMdlLighting: async (_path: string, _mode: string, _level: number, _previousMode: string, _previousLevel: number, requestId: string) => {
    fixture.writes.push('lighting');
    fixture.lastLightingRequest = requestId;
    const emit=(percent: number, id=requestId)=>window.dispatchEvent(new CustomEvent('mod-profile-progress', {
      detail:{operation:'lighting',requestId:id,step:'shaders',percent},
    }));
    emit(100,'an-earlier-save');
    for(const percent of [20,40,60]) emit(percent);
    if(fixture.failLighting) throw new Error('fixture lighting failed');
    emit(100);
    return true;
  },
  updateObjectShader: async () => true,
  updatePostProcessing: async () => true,
  updatePostProcessingGlow: async () => true,
  updateHdrExposure: async (_path:string,value:number) => {if(fixture.failExposure)throw Error('fixture exposure failure');fixture.writes.push('hdr-exposure');fixture.saved={...fixture.saved,hdrExposure:value};return true;},
  updateHdr: async () => { fixture.writes.push('hdr'); return true; },
  updatePostProcessingOutline: async () => true,
  updateReadability: async () => { fixture.writes.push('readability'); return true; },
  updateGlowSettings: async (_path: string, weak: boolean) => { fixture.weakGlow = weak; return true; },
  updateFoliageSettings: async () => { fixture.writes.push('foliage'); return true; },
  syncUISettings: async () => true,
};
const previousWindow = (globalThis as any).window;
(globalThis as any).window = Object.assign(new EventTarget(), { electronAPI: api });
const originalLog = console.log;
const originalError = console.error;
const originalSetTimeout = globalThis.setTimeout;
// Existing IPC timeout races must not keep a completed fixture alive for 45s.
globalThis.setTimeout = ((callback: any, delay: number, ...args: any[]) => {
  const timer = originalSetTimeout(callback, delay, ...args);
  if (delay > 1000) timer.unref();
  return timer;
}) as typeof setTimeout;
console.log = () => {};
console.error = () => {};

function buttonDisabled(label: string, category: string): boolean {
  fixture.category = category;
  const html = renderToStaticMarkup(React.createElement(SettingsModal, { open: true, onClose() {}, isFullPackageInstalled: fixture.fullPackage }));
  const button = [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].find(match => match[2] === label);
  assert(button, `missing actual SettingsModal button: ${label}`);
  return /\bdisabled/.test(button[1]);
}
try {
  const originalSettings={...fixture.saved};
  fixture.saved={...fixture.saved,resolvedVersion:'v301',graphicsSelection:'hd',hdr:true,hdrExposure:1.2};hook.store.modSettings={...fixture.saved};
  for(const [mode,value] of [['rpg',0.9],['standard',1.2],['battle',1.8]] as const){
    await hook.saveModSettings('Z:/fixture-game',{lighting:mode});
    assert.equal(fixture.saved.hdrExposure,value);assert.equal(hook.store.modSettings.hdrExposure,value);
  }
  fixture.writes.length=0;
  await hook.saveModSettings('Z:/fixture-game',{hdrExposure:2.4});
  assert.deepEqual(fixture.writes,['hdr-exposure'],'slider release must not resync shaders or DNC');
  assert.equal(hook.store.modSettings.hdrExposure,2.4);
  fixture.category='graphics';
  const graphicsHdr=renderToStaticMarkup(React.createElement(SettingsModal,{open:true,onClose(){},isFullPackageInstalled:true}));
  assert(!graphicsHdr.includes('settings.hdr.title'),'old HDR control removed from graphics page');
  fixture.category='lighting';
  const lightingHdr=renderToStaticMarkup(React.createElement(SettingsModal,{open:true,onClose(){},isFullPackageInstalled:true}));
  assert.equal((lightingHdr.match(/aria-label="settings.hdr.title"/g)||[]).length,1);
  assert(lightingHdr.includes('settings.hdr.brightness'));assert(lightingHdr.includes('min="0.75"'));assert(lightingHdr.includes('max="2.4"'));
  await hook.saveModSettings('Z:/fixture-game',{hdr:false});
  assert.equal(hook.store.modSettings.hdrExposure,2.4);
  const offHdr=renderToStaticMarkup(React.createElement(SettingsModal,{open:true,onClose(){},isFullPackageInstalled:true}));
  assert(!offHdr.includes('settings.hdr.brightness'),'HDR-off hides the exposure slider');
  fixture.failExposure=true;await assert.rejects(hook.saveModSettings('Z:/fixture-game',{hdrExposure:0.75}),/exposure failure/);fixture.failExposure=false;
  assert.equal(hook.store.modSettings.hdrExposure,2.4);assert.equal(fixture.saved.hdrExposure,2.4);
  fixture.category='game';fixture.saved={...originalSettings};hook.store.modSettings={...originalSettings};
  // The exact reported flow, repeated in the same client session.
  for (let round = 0; round < 2; round++) {
    await hook.saveModSettings('Z:/fixture-game', { terrain: 'latest' });
    await hook.saveModSettings('Z:/fixture-game', { tree: 'tall' });
    assert.equal(hook.store.modSettings.tree, 'tall');
    await hook.saveModSettings('Z:/fixture-game', { graphicsSelection: 'de' });
    assert.equal(hook.store.modSettings.resolvedGraphics, 'de');
    assert.equal(fixture.saved.resolvedGraphics, 'de');
    assert.equal(hook.store.modSettings.terrain, 'latest', 'DE must retain the selected terrain');
    assert(fixture.writes.includes('terrain:latest'));
    assert.equal(fixture.saved.tree, 'original');
    assert.equal(hook.store.modSettings.tree, 'original');
    assert.equal(fixture.treeRequests.at(-1), 'original', 'entering DE must apply original tree resources');
    await hook.saveModSettings('Z:/fixture-game', { tree: 'tall' });
    assert.equal(hook.store.modSettings.tree, 'tall', 'DE still allows manually selected trees');
    await hook.saveModSettings('Z:/fixture-game', { versionSelection: 'v30' });
    await hook.saveModSettings('Z:/fixture-game', { graphicsSelection: 'de' });
    assert.equal(fixture.saved.tree, 'tall', 'remaining in DE must preserve manual tree selection');
    assert.equal(fixture.treeRequests.at(-1), 'tall');
    for (const terrain of ['latest', 'v16', 'v18', 'retro', 'original', 'decisive'] as const) {
      await hook.saveModSettings('Z:/fixture-game', { terrain });
      assert.equal(fixture.saved.terrain, terrain);
      assert.equal(fixture.saved.resolvedGraphics, 'de');
    }
    assert.equal(buttonDisabled('settings.terrain.latest', 'game'), false);
    assert.equal(buttonDisabled('settings.tree.height.16', 'game'), false);
    assert.equal(buttonDisabled('settings.tree.height.18', 'game'), false);
    assert.equal(buttonDisabled('settings.terrain.retro', 'game'), false);
    assert.equal(buttonDisabled('settings.water.transparent', 'game'), true);
    await hook.saveModSettings('Z:/fixture-game', { graphicsSelection: 'hd' });
    assert.equal(hook.store.modSettings.resolvedGraphics, 'hd');
    assert.equal(fixture.saved.resolvedGraphics, 'hd');
    assert.equal(buttonDisabled('settings.terrain.latest', 'game'), false);
    assert.equal(buttonDisabled('settings.water.transparent', 'game'), false);
    for (const terrain of ['latest', 'v16', 'v18', 'retro', 'original', 'decisive'] as const) {
      await hook.saveModSettings('Z:/fixture-game', { terrain });
      assert.equal(hook.store.modSettings.terrain, terrain);
      assert.equal(fixture.saved.resolvedGraphics, 'hd');
    }
    // Even a stale renderer snapshot must not overwrite a newer main-process result.
    hook.store.modSettings = { ...hook.store.modSettings, resolvedGraphics: 'de', resolvedVersion: 'v204' };
    assert.equal(buttonDisabled('settings.terrain.latest', 'game'), false);
    assert.equal(buttonDisabled('settings.water.transparent', 'game'), false);
    await hook.saveModSettings('Z:/fixture-game', { ui: 'quenching' });
    assert.equal(fixture.saved.resolvedGraphics, 'hd');
    assert.equal(hook.store.modSettings.resolvedVersion, 'v30');
    hook.store.modSettings = { ...hook.store.modSettings, resolvedGraphics: 'de' };
    await hook.saveModSettings('Z:/fixture-game', { blight: round === 0 });
    assert.equal(fixture.saved.resolvedGraphics, 'hd');
  }
  // Actual hook applies a multi-field preset; Blight must not short-circuit it.
  for (const preset of ['battle', 'standard'] as const) {
    fixture.writes.length = 0;
    const progress: number[]=[];
    await hook.saveModSettings('Z:/fixture-game', renderingPresetSettings(preset), (_step: string, percent: number)=>progress.push(percent));
    assert(!fixture.writes.includes('foliage'), 'terrain already applied the preset foliage; do not extract it twice');
    assert(progress.includes(22)&&progress.includes(33)&&progress.includes(43), 'live lighting IPC reports reach the active save');
    assert(progress.includes(68)&&progress.includes(76)&&progress.includes(95), 'terrain, trees and remaining preset work advance progress');
    assert.equal(progress.at(-1),100);
    assert.equal(progress.filter(p=>p===100).length,1,'100% is emitted only after the whole preset');
    assert(progress.every((p,i)=>i===0||p>=progress[i-1]),'progress must not move backwards');
    assert(matchesRenderingPreset(fixture.saved, preset), 'all preset fields persist');
    assert(fixture.writes.includes('lighting'));
    assert(fixture.writes.includes('readability'));
    assert.equal(fixture.weakGlow, preset === 'standard');
    await hook.loadModSettings('Z:/fixture-game');
    assert.equal(hook.store.modSettings.improveReadability, preset === 'battle', 'stored preference survives settings reload');
    assert.equal(hook.store.modSettings.postProcessingOutline, preset === 'battle');
  }
  await hook.saveModSettings('Z:/fixture-game', renderingPresetSettings('battle'));
  const realSetTimeout = globalThis.setTimeout;
  fixture.delayTerrain = true;
  fixture.releaseTerrain = null;
  const slowProgress: number[] = [];
  // Compress the old 45-second renderer deadline; real work remains in flight.
  globalThis.setTimeout = ((fn: any, ms: number, ...args: any[]) => realSetTimeout(fn, ms === 45000 ? 1 : ms, ...args)) as any;
  let slowFailure: unknown;
  const slowPreset = hook.saveModSettings('Z:/fixture-game', renderingPresetSettings('standard'), (_s: string, p: number) => slowProgress.push(p));
  void slowPreset.catch((error: unknown) => { slowFailure = error; });
  try {
    await new Promise(resolve => realSetTimeout(resolve, 30));
    assert(fixture.releaseTerrain, 'terrain worker has started');
    assert.equal(slowFailure, undefined, 'a slow but active terrain operation must not time out in the renderer');
    assert.equal(hook.store.isLoading, true, 'keep controls locked until the worker settles');
    assert(!slowProgress.includes(100), 'stale request progress cannot finish the preset');
    fixture.releaseTerrain();
    await slowPreset;
    assert(matchesRenderingPreset(fixture.saved, 'standard'));
    assert.equal(slowProgress.at(-1), 100);
    const count = slowProgress.length;
    window.dispatchEvent(new CustomEvent('mod-profile-progress', { detail: { operation: 'terrain', requestId: fixture.lastTerrainRequest, step: 'finish', percent: 100 } }));
    assert.equal(slowProgress.length, count, 'settled terrain requests remove their progress listener');
  } finally {
    fixture.releaseTerrain?.(); fixture.delayTerrain = false; globalThis.setTimeout = realSetTimeout;
  }
  fixture.failLighting=true;
  const failedProgress: number[]=[];
  await assert.rejects(hook.saveModSettings('Z:/fixture-game',{lighting:'battle'},(_s:string,p:number)=>failedProgress.push(p)),/fixture lighting failed/);
  assert(!failedProgress.includes(100),'failed save cannot complete its progress');
  const afterFailure=failedProgress.length;
  window.dispatchEvent(new CustomEvent('mod-profile-progress',{detail:{operation:'lighting',requestId:fixture.lastLightingRequest,step:'finish',percent:100}}));
  assert.equal(failedProgress.length,afterFailure,'failed save removes its progress listener');
  fixture.failLighting=false;
  await hook.saveModSettings('Z:/fixture-game',{lighting:'rpg'});
  assert.equal(fixture.saved.lighting,'rpg','RPG lighting is saved independently of Home presets');
  await hook.loadModSettings('Z:/fixture-game');
  assert.equal(hook.store.modSettings.lighting,'rpg','RPG survives reloading settings');
  fixture.category='lighting';
  assert(renderToStaticMarkup(React.createElement(SettingsModal,{open:true,onClose(){},isFullPackageInstalled:true})).includes('settings.lighting.rpg'),'RPG is available in detailed lighting settings');
  fixture.category = 'basic';
  assert(!renderToStaticMarkup(React.createElement(SettingsModal, { open: true, onClose() {}, isFullPackageInstalled: true })).includes('intelAmdShaderFix'));
  for (const hdr of [false, true]) {
    const before = { ...hook.store.modSettings }, writes = fixture.writes.length;
    await hook.saveModSettings('Z:/fixture-game', { hdr });
    assert.deepEqual(fixture.writes.slice(writes), ['hdr'], 'HDR changes only its own resource endpoint');
    assert.deepEqual(fixture.saved, { ...before, hdr }, 'HDR preference is persisted independently');
  }
  const withHdr = { ...fixture.saved };
  delete fixture.saved.hdr; fixture.saved.postProcessing = false;
  await hook.loadModSettings('Z:/fixture-game');
  assert.equal(hook.store.modSettings.hdr, false, 'Old shadow-off preferences migrate without turning HDR on');
  fixture.saved = withHdr;
  await hook.loadModSettings('Z:/fixture-game');
  assert.equal(hook.store.modSettings.hdr, true, 'HDR preference survives reloading');
  const beforeReadabilityUi = { ...hook.store.modSettings };
  fixture.category = 'graphics';
  const graphicsHtml = renderToStaticMarkup(React.createElement(SettingsModal, { open: true, onClose() {}, isFullPackageInstalled: true }));
  assert(graphicsHtml.includes('settings-graphics-grid'));
  assert.equal((graphicsHtml.match(/data-span="8"/g) || []).length, 9, 'graphics settings retain three columns after moving HDR to lighting');
  const switches = [...graphicsHtml.matchAll(/<button([^>]*role="switch"[^>]*)>/g)];
  assert.equal(switches.length, 9, 'graphics Boolean settings use single switches');
  assert(!switches.some(match => match[1].includes('aria-label="settings.hdr.title"')));
  fixture.category='lighting';
  const lightingHtml=renderToStaticMarkup(React.createElement(SettingsModal,{open:true,onClose(){},isFullPackageInstalled:true}));
  const rotating = [...lightingHtml.matchAll(/<button([^>]*role="switch"[^>]*)>/g)].find(match => match[1].includes('aria-label="settings.rotatingLighting.title"'));
  assert(rotating?.[1].includes('aria-checked="false"'), 'Experimental lighting defaults to off');
  assert(lightingHtml.includes('settings.experimental'));
  assert(lightingHtml.includes('type="range"') && lightingHtml.includes('max="360"'));
  fixture.category='game';
  const gameHtml=renderToStaticMarkup(React.createElement(SettingsModal,{open:true,onClose(){},isFullPackageInstalled:true}));
  assert(gameHtml.includes('settings.water.realistic') && !gameHtml.includes('settings.lighting.rpg'));
  assert(!graphicsHtml.includes('settings.water.realistic'));
  for(const angle of [0,90,180,360]) {
    const writes=fixture.writes.length,syncs=fixture.syncs;
    await hook.saveModSettings('Z:/fixture-game',{lightingAngle:angle});
    assert.deepEqual(fixture.writes.slice(writes),['lighting-angle']);
    assert.equal(fixture.syncs,syncs);
    assert.equal(fixture.saved.lightingAngle,angle);
  }
  fixture.failAngle=true;
  await assert.rejects(hook.saveModSettings('Z:/fixture-game',{lightingAngle:45}),/fixture angle failed/);
  assert.equal(hook.store.modSettings.lightingAngle,360);
  fixture.failAngle=false;
  const beforeRotating = { ...hook.store.modSettings };
  for (const enabled of [true, false]) {
    const writes = fixture.writes.length;
    const syncs = fixture.syncs;
    await hook.saveModSettings('Z:/fixture-game', { rotatingLighting: enabled });
    assert.deepEqual(fixture.writes.slice(writes), ['rotating-lighting'], 'A toggle must not invoke other resource updates');
    assert.equal(fixture.syncs, syncs);
    assert.equal(hook.store.modSettings.rotatingLighting, enabled);
    assert.deepEqual(fixture.saved, { ...beforeRotating, rotatingLighting: enabled });
  }
  fixture.failRotating = true;
  await assert.rejects(hook.saveModSettings('Z:/fixture-game', { rotatingLighting: true }), /fixture rotating lighting failed/);
  assert.equal(fixture.saved.rotatingLighting, false);
  assert.equal(hook.store.modSettings.rotatingLighting, false);
  fixture.failRotating = false;
  const beforeOffToggle = fixture.writes.length;
  fixture.enabled = false;
  await hook.saveModSettings('Z:/fixture-game', { rotatingLighting: true });
  assert.equal(fixture.writes.length, beforeOffToggle, 'A parked MOD only stores the preference');
  assert.equal(fixture.saved.rotatingLighting, true);
  fixture.enabled = true;
  await hook.loadModSettings('Z:/fixture-game');
  assert.equal(hook.store.modSettings.rotatingLighting, true, 'Preference survives reloading');
  await hook.saveModSettings('Z:/fixture-game', { ...renderingPresetSettings('battle') });
  assert.equal(fixture.saved.rotatingLighting, true, 'Battle preset leaves the independent experiment unchanged');
  await hook.saveModSettings('Z:/fixture-game', { rotatingLighting: false });
  hook.store.modSettings = { ...beforeReadabilityUi };
  fixture.saved = { ...beforeReadabilityUi };
  fixture.category = 'graphics';
  for (const weak of [false, true]) {
    hook.store.modSettings = { ...beforeReadabilityUi, glow: weak };
    const glowHtml = renderToStaticMarkup(React.createElement(SettingsModal, { open: true, onClose() {}, isFullPackageInstalled: true }));
    const glow = [...glowHtml.matchAll(/<button([^>]*role="switch"[^>]*)>/g)].find(match => match[1].includes('aria-label="settings.glow.title"'));
    assert(glow?.[1].includes(`aria-checked="${weak}"`), 'reduce hero glow switch on means weak, off restores default glow');
    assert(glowHtml.includes(weak ? 'settings.glow.weak' : 'settings.glow.strong'));
  }
  hook.store.modSettings = { ...beforeReadabilityUi };
  for (const [label, value] of [
    ['settings.foliage.title', hook.store.modSettings.foliage],
    ['settings.blight.title', hook.store.modSettings.blight],
    ['settings.shader.title', hook.store.modSettings.objectShader],
    ['settings.postprocessing.title', hook.store.modSettings.postProcessing],
    ['settings.postprocessing.glow.title', hook.store.modSettings.postProcessingGlow],
  ] as const) {
    const control = switches.find(match => match[1].includes(`aria-label="${label}"`));
    assert(control, label);
    assert(control[1].includes(`aria-checked="${Boolean(value)}"`), label + ' matches the saved setting');
  }
  hook.store.isLoading = true;
  const busyHtml = renderToStaticMarkup(React.createElement(SettingsModal, { open: true, onClose() {}, isFullPackageInstalled: true }));
  for (const control of busyHtml.matchAll(/<button([^>]*role="switch"[^>]*)>/g)) assert(/\bdisabled/.test(control[1]));
  hook.store.isLoading = false;
  for (const [graphicsSelection, resolvedVersion, disabled] of [
    ['hd', 'v301', false], ['de', 'v301', false], ['de', 'v30', true], ['sd', 'v301', true],
    ['hd', 'v204', true],
  ] as const) {
    hook.store.modSettings = { ...beforeReadabilityUi, graphicsSelection, resolvedVersion, objectShader: true, postProcessing: true };
    const html = renderToStaticMarkup(React.createElement(SettingsModal, { open: true, onClose() {}, isFullPackageInstalled: true }));
    const at = html.indexOf('settings.readability.title');
    assert(at >= 0);
    const section = html.slice(at, html.indexOf('<h3', at + 1));
    const buttons = [...section.matchAll(/<button([^>]*)>/g)];
    assert.equal(buttons.length, 1, 'readability uses a single switch');
    assert(buttons[0][1].includes('role="switch"'));
    for (const button of buttons) assert.equal(/\bdisabled/.test(button[1]), disabled, `${graphicsSelection}/${resolvedVersion} readability availability`);
  }
  hook.store.modSettings = beforeReadabilityUi;
  // DE itself and the full-package prerequisite remain restricted.
  fixture.fullPackage = false;
  assert.equal(buttonDisabled('settings.terrain.latest', 'game'), true);
  fixture.fullPackage = true;
  fixture.failSync = true;
  await assert.rejects(hook.saveModSettings('Z:/fixture-game', { graphicsSelection: 'de' }), /missing profile assets/);
  assert.equal(fixture.saved.graphicsSelection, 'hd');
  assert.equal(hook.store.modSettings.resolvedGraphics, 'hd');
  assert.equal(hook.store.isLoading, false);
  fixture.failSync = false;

  await hook.saveModSettings('Z:/fixture-game', { graphicsSelection: 'sd' });
  assert.equal(hook.store.modSettings.resolvedGraphics, 'sd');
  assert.equal(buttonDisabled('settings.terrain.latest', 'game'), true);
  await hook.saveModSettings('Z:/fixture-game', { graphicsSelection: 'de' });
  assert.equal(fixture.saved.tree, 'original', 'SD to DE also resets tree selection');
  assert.equal(fixture.treeRequests.at(-1), 'original');
  fixture.enabled = false;
  const syncs = fixture.syncs, writes = fixture.writes.length;
  await hook.saveModSettings('Z:/fixture-game', { graphicsSelection: 'hd' });
  assert.equal(fixture.syncs, syncs);
  assert.equal(fixture.writes.length, writes);
  assert.equal(hook.store.modSettings.resolvedGraphics, 'de', 'off switch retains last applied profile until enabled');
  assert.equal(buttonDisabled('settings.terrain.latest', 'game'), false, 'explicit HD is not locked by parked DE');
  assert.equal(buttonDisabled('settings.water.transparent', 'game'), false);
} finally {
  console.log = originalLog;
  console.error = originalError;
  globalThis.setTimeout = originalSetTimeout;
  if (previousWindow === undefined) delete (globalThis as any).window;
  else (globalThis as any).window = previousWindow;
  delete (globalThis as any).__graphicsSettingsFixture;
}
console.log('PASS: graphics transitions, original trees on entering DE, manual DE trees, terrain choices, water unlock, stale profile writes, failed sync rollback and MOD-off/SD restrictions');
