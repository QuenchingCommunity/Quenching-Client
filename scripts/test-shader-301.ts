import { resourcePath } from '../src/shared/bundled-resource-paths.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { withShaderBundle } from '../src/Main/services/shader-bundle';
import { setPostProcessingTonemapEnabled } from '../src/Main/services/post-processing-config';

// Services run against isolated paths; the real game/registry/processes are not used.
const fixture = { parts: [3, 0, 0, 24268], channel: 'retail', settings: { lighting: 'standard', lightingBrightness: 3 }, handlers: new Map(), assets: '' };
(globalThis as any).__shader301Fixture = fixture;
const result = await build({
  stdin: { contents: `export { resolveModProfile, getShaderResourcePath, effectiveLightingMode } from './src/Main/services/mod-profile';
    export { skinEraForVersion } from './src/Main/services/unit-skin-profile';
    export { syncLightingResources, AssetSyncService } from './src/Main/services/asset-sync';
    export { GameLauncher } from './src/Main/services/game-launcher';
    export { registerShaderHandlers } from './src/Main/ipc/shader-handlers';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
  plugins: [{ name: 'shader-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^original-fs$/ }, () => ({ path: 'node:fs', external: true }));
    plugin.onResolve({ filter: /^electron$|\/(?:config-manager|game-channel|war3-version|full-package-service)$/ }, args =>
      args.path.endsWith('shared/game-channel') ? undefined : ({ path: args.path, namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: `const f=globalThis.__shader301Fixture;` + (
      args.path === 'electron' ? `export const app={getAppPath:()=>process.cwd(),getVersion:()=>"3.6.1",getPath:()=>process.cwd()};
        export const ipcMain={handle:(name,fn)=>f.handlers.set(name,fn)};`
      : args.path.endsWith('config-manager') ? `export const configManager={get:key=>key==='gameChannel'?f.channel:key==='modSettings'?f.settings:undefined,set:(key,value)=>{if(key==='modSettings')f.settings=value}};`
      : args.path.endsWith('game-channel') ? `export const getSelectedGameChannel=()=>f.channel; export const getSelectedGameFolder=()=>f.channel==='ptr'?'_ptr_':'_retail_';
        export const getChannelModEnabled=()=>true;export const hasGameChannelDirectory=async()=>true;`
      : args.path.endsWith('full-package-service') ? `const path=require('node:path');export const isFullPackageInstalled=async()=>true;
        export const assertFullPackageInstalled=async()=>{};export const assertTreeModeAvailable=async()=>{};
        export const resolveRetailDir=async root=>path.join(root,f.channel==='ptr'?'_ptr_':'_retail_');`
      : `export const detectWar3Version=async()=>({parts:f.parts,version:f.parts.join('.'),source:'fixture'});
        export const readShaderPackMarker=async()=> 'shaders-ptr-hd';
        export const resolveUiZipName=async()=>'';
        export const isShaderPackCurrent=async()=>false;export const normalizeShaderExtractLayout=async()=>{};
        export const resolveShaderZipName=async()=>'';export const writeShaderPackMarker=async()=>{};`
    ) }));
  } }],
});
const module = { exports: {} as any };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const api = module.exports;
const quenching = path.resolve(process.argv[3] || path.join(process.cwd(), 'assets/quenching'));
const knownGood = process.argv[2];
const testParent = path.resolve('_tmp/resource-bundle-20261028'); await fs.ensureDir(testParent);
const root = await fs.mkdtemp(path.join(testParent, 'quenching-shader-301-'));
const hashFile = async (file: string) => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
async function sameTree(installed: string, source: string, overrides: Record<string, string> = {}, prefix = '') {
  for (const item of await fs.readdir(source, { withFileTypes: true })) {
    const relative = prefix + item.name;
    if (item.isDirectory()) await sameTree(path.join(installed, item.name), path.join(source, item.name), overrides, relative + '/');
    else assert.equal(await hashFile(path.join(installed, item.name)), await hashFile(overrides[relative] ?? path.join(source, item.name)), relative);
  }
}
try {
  for (const channel of ['retail', 'ptr']) {
    fixture.channel = channel;
    for (const [parts, version] of [[[3,0,0,24268], 'v30'], [[3,0,1,24342], 'v301'], [[3,0,1,24368], 'v301'], [[3,1,0], 'v301'], [[2,0,4], 'v204']] as const) {
      fixture.parts = [...parts];
      for (const graphics of ['hd', 'de'] as const) {
        const profile = await api.resolveModProfile(root, { versionSelection: 'auto', graphicsSelection: graphics });
        const effectiveVersion = channel === 'ptr' ? 'v301' : version;
        assert.equal(profile.version, effectiveVersion);
        const expected = channel === 'ptr' ? `shaders-ptr-${graphics}` : effectiveVersion === 'v301'
          ? `shaders-300-${graphics}` : effectiveVersion === 'v30' ? `shaders-300-legacy-${graphics}` : 'shaders203';
        assert.equal(profile.shaderPack, expected);
        assert.equal(profile.graphics, effectiveVersion === 'v204' ? 'hd' : graphics);
        const retired = await api.resolveModProfile(root, { versionSelection: 'auto', graphicsSelection: graphics, lighting: 'rpg' });
        assert.equal(retired.dncPack, profile.dncPack, 'retired RPG cannot select its separate DNC pack');
        assert.equal(retired.usesPublicEnvironment, profile.usesPublicEnvironment, 'retired RPG preserves Standard environment selection');
        if (channel !== 'ptr' || parts.join('.') === '3.0.1.24368') {
          if (profile.version === 'v301' && profile.graphics === 'hd') {
            assert(api.getShaderResourcePath(quenching, profile, 'rpg').endsWith(path.join('ps','rpg')), 'modern HD RPG selects its derived Standard material');
          } else assert.equal(api.getShaderResourcePath(quenching, profile, 'rpg'), api.getShaderResourcePath(quenching, profile, 'standard'));
          assert.equal(api.effectiveLightingMode(profile, 'rpg'), profile.graphics === 'de' ? 'standard' : 'rpg');
        }
        if (channel === 'ptr') {
          const supported = parts.join('.') === '3.0.1.24368';
          assert.equal(profile.ptrShaderCompatibility.status, supported ? 'supported' : 'unverified');
          assert.equal(profile.dncPack, graphics === 'de' ? 'dnc30-de' : 'dnc30-hd');
          if (!supported) assert.throws(() => api.getShaderResourcePath(quenching, profile), /shader compatibility is not verified/);
        }
      }
    }
    fixture.parts = [3,0,1,24368];
    assert.equal((await api.resolveModProfile(root, { versionSelection: 'v30', graphicsSelection: 'hd' })).shaderPack, channel === 'ptr' ? 'shaders-ptr-hd' : 'shaders-300-legacy-hd');
    fixture.parts = [3,0,0,24268];
    const legacy = await api.resolveModProfile(root, { versionSelection: 'auto', graphicsSelection: 'hd' });
    assert.equal(legacy.shaderPack, channel === 'ptr' ? 'shaders-ptr-hd' : 'shaders-300-legacy-hd');
  }
  assert.equal(api.skinEraForVersion('v301'), 'v30', '3.0.1 keeps modern skins/DNC, not 2.x templates');
  const fixtureAssets = path.join(root, 'assets'); fixture.assets = fixtureAssets;
  await fs.ensureDir(path.join(fixtureAssets, 'quenching'));
  await fs.copy(resourcePath(quenching, 'shaders'), path.join(fixtureAssets, 'quenching/shaders'));
  const fixtureQuenching = path.join(fixtureAssets, 'quenching');
  for (const pack of ['dnc30-hd', 'dnc30-de', 'dnc30-de-rpg']) await fs.outputFile(path.join(fixtureQuenching, 'dnc', pack, 'test.mdl'), 'Version { FormatVersion 800, }');
  await fs.outputFile(path.join(fixtureQuenching, 'PostProcessingConfig.txt'), 'UseAmbientOcclusion=0');
  api.AssetSyncService.getAssetsDir = async () => fixtureAssets;
  api.AssetSyncService.ensurePostProcessingConfig = async (_root: string, _ao: boolean, hdr?: boolean) => {
    const target=path.join(root, '_retail_/PostProcessingConfig.txt');
    if (!await fs.pathExists(target)) await fs.outputFile(target,'[Tonemap]\nEnabled=1\nExposure=0.88\n');
    if (hdr !== undefined) await setPostProcessingTonemapEnabled(path.join(root, '_retail_'), hdr);
  };

  for (const [channel, parts, graphics] of [
    ['retail', [3,0,0,24268], 'hd'], ['retail', [3,0,0,24268], 'de'],
    ['ptr', [3,0,1,24368], 'de'],
    ['retail', [3,0,1,24342], 'hd'], ['ptr', [3,0,1,24368], 'hd'], ['retail', [3,0,1,24342], 'de'],
  ] as const) {
    fixture.channel = channel; fixture.parts = [...parts];
    const profile = await api.resolveModProfile(root, { versionSelection: 'auto', graphicsSelection: graphics });
    const branch = path.join(root, channel === 'ptr' ? '_ptr_' : '_retail_'); await fs.ensureDir(branch);
    await api.syncLightingResources(root, fixtureQuenching, { lighting: 'standard', lightingBrightness: 3 }, profile);
    await withShaderBundle(quenching, profile.shaderPack, root, async selected => {
      const target = path.join(branch, 'shaders');
      const ps = api.getShaderResourcePath(selected, profile, 'standard');
      // A verified PTR pack can retain its independent base Fog. The selected
      // shared override is authoritative after installation, including baseline outlines.
      const fogOverrides: Record<string, string> = {};
      if (profile.version === 'v301') for (const file of ['fog.bls', 'volumetricfog.bls']) {
        fogOverrides[(graphics === 'hd' ? '' : 'ps/') + file] = resourcePath(selected, 'shaders', profile.fogShaderPack || 'fog_shaders', 'ao_080', 'ps', file);
      }
      if (graphics === 'hd') {
        await sameTree(path.join(target, 'ps'), ps, fogOverrides);
        await sameTree(path.join(target, 'vs'), resourcePath(selected, 'shaders', profile.shaderPack, 'vs'));
      } else {
        await sameTree(path.join(target,'ps'),path.join(ps,'ps'),Object.fromEntries(Object.entries(fogOverrides).map(([name,file])=>[name.replace(/^ps\//,''),file])));
        await sameTree(path.join(target,'vs'),path.join(ps,'vs'));
      }
      assert.equal(selected, quenching, 'Shader synchronization reuses prepared sources without temporary ZIP expansion');
      if (knownGood && profile.version === 'v30') {
        const oldPack = path.join(knownGood, 'shaders', `shaders-300-${graphics}`);
        await sameTree(resourcePath(selected, 'shaders', profile.shaderPack), oldPack);
      }
    });
    assert.equal((await fs.readdir(branch)).some(name => name.startsWith('.quenching-shader-assets-')), false, 'staging cleaned after success');
  }
  await assert.rejects(() => withShaderBundle(quenching, 'shaders-300-hd', root, async () => { throw new Error('injected failure'); }), /injected failure/);
  assert.equal((await fs.readdir(root)).some(name => name.startsWith('.quenching-shader-assets-')), false, 'staging cleaned after failure');
  api.registerShaderHandlers(); fixture.parts = [3,0,1,24368]; fixture.channel = 'retail';
  assert.equal(fixture.handlers.has('shader:update-intel-amd'), false, 'retired hardware fix has no IPC handler');
  for (const method of ['shader:update-object-shader', 'shader:update-post-processing', 'shader:update-post-processing-glow', 'shader:update-post-processing-outline', 'shader:update-readability', 'shader:update-hdr']) {
    const extracted: string[] = [];
    const createWriteStream = fs.createWriteStream;
    (fs as any).createWriteStream = (file: string, ...args: any[]) => {
      if (String(file).includes('.quenching-shader-assets-')) extracted.push(String(file).replace(/\\/g, '/'));
      return (createWriteStream as any)(file, ...args);
    };
    try {
      const started = performance.now();
      assert.equal(await fixture.handlers.get(method)({}, root, true), true, method + ' from prepared resources');
      console.log(`[PERF] ${method}: ${Math.round(performance.now() - started)}ms, ${extracted.length} extracted files`);
    } finally { (fs as any).createWriteStream = createWriteStream; }
    const stages = new Set(extracted.map(file => file.match(/\.quenching-shader-assets-[^/]+/)![0]));
    assert.equal(stages.size, 0, method + ' does not create per-effect ZIP extraction trees');
    assert.equal(extracted.length, 0);
  }
  const hdrPath = path.join(root, '_retail_/shaders/ps/tonemap.bls');
  assert(await fs.pathExists(hdrPath));
  const fogBeforeHdr = await fs.readFile(path.join(root, '_retail_/shaders/ps/fog.bls'));
  const bloomBeforeHdr = await fs.readFile(path.join(root, '_retail_/shaders/ps/bloomextract.bls'));
  await fixture.handlers.get('shader:update-hdr')({}, root, false);
  assert.match(await fs.readFile(path.join(root, '_retail_/PostProcessingConfig.txt'), 'utf8'), /\[Tonemap\]\nEnabled=0/);
  assert(!await fs.pathExists(hdrPath));
  assert.deepEqual(await fs.readFile(path.join(root, '_retail_/shaders/ps/fog.bls')), fogBeforeHdr);
  assert.deepEqual(await fs.readFile(path.join(root, '_retail_/shaders/ps/bloomextract.bls')), bloomBeforeHdr);
  await fixture.handlers.get('shader:update-hdr')({}, root, true);
  assert.match(await fs.readFile(path.join(root, '_retail_/PostProcessingConfig.txt'), 'utf8'), /\[Tonemap\]\nEnabled=1/);
  await assert.rejects(fixture.handlers.get('shader:update-hdr')({}, root, 'true'), /Invalid HDR/);
  const createWriteStream = fs.createWriteStream;
  const disabledExtracted: string[] = [];
  (fs as any).createWriteStream = (file: string, ...args: any[]) => {
    if (String(file).includes('.quenching-shader-assets-')) disabledExtracted.push(String(file).replace(/\\/g, '/'));
    return (createWriteStream as any)(file, ...args);
  };
  try {
    assert.equal(await fixture.handlers.get('shader:update-object-shader')({}, root, false), true);
    assert(disabledExtracted.every(file => file.includes('/fog_shaders/')), 'object off needs only active fog/identity writers');
    for (const file of ['hd.bls','sd_on_hd.bls','foliage.bls']) assert.equal(crypto.createHash('sha256').update(await fs.readFile(path.join(root,'_retail_/shaders/ps',file))).digest('hex'),crypto.createHash('sha256').update(await fs.readFile(path.resolve('assets/unpacked/shaders/fog_shaders/identity_writers/ps',file))).digest('hex'));
    assert.equal(await fixture.handlers.get('shader:update-object-shader')({}, root, true), true);
  } finally { (fs as any).createWriteStream = createWriteStream; }
  const current = path.join(root, '_retail_/shaders');
  assert.ok(await fs.pathExists(path.join(current, 'ps/terrain.bls')));
  assert.ok(await fs.pathExists(path.join(current, 'ps/bloomextract.bls')));
  fixture.channel = 'ptr'; fixture.parts = [3,0,1,24368];
  await fixture.handlers.get('shader:update-post-processing-outline')({}, root, true);
  const ptrShaders = path.join(root, '_ptr_', 'shaders');
  const snapshotTree = async (folder: string): Promise<Record<string, string>> => {
    const files: Record<string, string> = {};
    const visit = async (dir: string) => {
      for (const item of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) await visit(full);
        else files[path.relative(folder, full)] = await hashFile(full);
      }
    };
    await visit(folder); return files;
  };
  const ptrBefore = await snapshotTree(ptrShaders);
  const retailBefore = await snapshotTree(current);
  for (const parts of [[2,0,4], [3,0,1,24369], [3,0,2,1], [4,0,0,1]]) {
    fixture.parts = parts;
    const profile = await api.resolveModProfile(root, { versionSelection: 'v301', graphicsSelection: 'de' });
    assert.equal(profile.version, 'v301', 'PTR never falls back to a 2.x logical tier');
    assert.equal(profile.dncPack, 'dnc30-de');
    assert.equal(profile.shaderPack, 'shaders-ptr-de');
    await assert.rejects(() => api.syncLightingResources(root, fixtureQuenching, fixture.settings, profile), /shader compatibility is not verified/);
    await assert.rejects(() => api.GameLauncher.syncDetectedVersionBeforeLaunch(root), /shader compatibility is not verified/, 'existing pack marker must not bypass PTR build validation');
    for (const method of ['shader:update-object-shader', 'shader:update-post-processing', 'shader:update-post-processing-glow', 'shader:update-post-processing-outline', 'shader:update-readability']) {
      for (const enabled of [false, true]) await assert.rejects(() => fixture.handlers.get(method)({}, root, enabled), /shader compatibility is not verified/);
    }
    assert.deepEqual(await snapshotTree(ptrShaders), ptrBefore, 'unverified PTR leaves installed shaders untouched');
    assert.deepEqual(await snapshotTree(current), retailBefore, 'PTR checks never modify Retail');
  }
  fixture.parts = [3,0,0,24268];
  const unverifiedLegacyPtr = await api.resolveModProfile(root, { versionSelection: 'auto' });
  assert.throws(() => api.getShaderResourcePath(quenching, unverifiedLegacyPtr), /shader compatibility is not verified/);
  assert.deepEqual(await snapshotTree(ptrShaders), ptrBefore);
  assert.deepEqual(await snapshotTree(current), retailBefore);
  fixture.parts = [0];
  await assert.rejects(() => api.resolveModProfile(root, { versionSelection: 'v301' }), /Quenching 3\.7 requires/);
  console.log('PASS: 2.04 / 3.0 / latest selection, independent legacy ZIP installs, Retail/PTR, HD/DE, effect toggles, selected-pack expansion and cleanup');
} finally {
  delete (globalThis as any).__shader301Fixture;
  await fs.remove(root);
}
