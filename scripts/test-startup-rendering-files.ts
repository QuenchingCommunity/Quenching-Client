import { resourcePath } from '../src/shared/bundled-resource-paths.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import fs from 'fs-extra';
import archiver from 'archiver';
import { build } from 'esbuild';
import { parseSkinSections } from '../src/shared/skin-versions';
import { renderDncLighting } from '../src/Main/services/dnc-lighting';
import { lightDirection } from '../src/shared/dnc-rotation';
import { ROTATING_UNIT_FILES, replaceUnitRotation, unitRotationBlock } from '../src/Main/services/rotating-lighting';

const taskRoot = path.resolve('_tmp/rotating-lighting-20261027');
await fs.ensureDir(taskRoot);
const root = await fs.mkdtemp(path.join(taskRoot, 'startup-files-'));
const f = { root, assets: path.join(root, 'assets'), channel: 'retail', enabled: true, settings: {} as any,
  handlers: new Map<string, (...args: any[]) => Promise<any>>() };
(globalThis as any).__startupFiles = f;
const mocks: Record<string, string> = {
  electron: 'export const app={getAppPath:()=>f.root};export const ipcMain={handle:(channel,fn)=>f.handlers.set(channel,fn)};',
  'config-manager': 'export const configManager={get:k=>k==="modSettings"?f.settings:k==="gameChannel"?f.channel:k==="war3Path"?f.root:undefined,set:(k,v)=>{if(k==="modSettings")f.settings=v;}};',
  'game-channel': 'export const getSelectedGameChannel=()=>f.channel;export const getSelectedGameFolder=()=>f.channel==="ptr"?"_ptr_":"_retail_";export const getChannelModEnabled=()=>f.enabled;export const hasGameChannelDirectory=async()=>true;',
  'full-package-service': 'export const resolveRetailDir=async root=>root+"/"+(f.channel==="ptr"?"_ptr_":"_retail_");export const isFullPackageInstalled=async()=>false;',
  'war3-version': 'export const detectWar3Version=async()=>({source:"build.info",parts:[3,0,1,24368],version:"3.0.1.24368"});',
  'mod-update-service': 'export const getInstalledModState=async()=>({sequence:35});',
  'mod-integrity-service': 'export const readCurrentModVersion=async()=>"3.5";',
  'third-party-resources': 'export const isThirdPartyQuenchingPaused=async()=>false;export const markKnownQuenching=async()=>{};',
  'destructable-skin-profile': 'export const destructableSkinTemplate=()=>"unused";',
  'webui-assets-service': 'export const syncClientWebUIFiles=async()=>{};',
  'graphics-layout-service': 'export const parkNonHdUnitsAndBuildings=async()=>{};export const restoreHdUnitsAndBuildings=async()=>{};export const restoreSdParkedResources=async()=>{};export const syncGraphicsLayout=async()=>({});',
  'tree-handlers': 'export const applyTreeSettings=async()=>{};',
  'water-handlers': 'export const applyWaterSettings=async()=>{};',
  'ui-service': 'export const UIService={syncConfiguredUI:async()=>{}};',
  'retro-skin-service': 'export const retroSkinService={apply:async()=>{}};',
};
try {
  const bundled = await build({
    stdin: { contents: 'export * from "./src/Main/services/asset-sync";export * from "./src/Main/services/mod-profile";export {registerMdlHandlers} from "./src/Main/ipc/mdl-handlers";', resolveDir: process.cwd(), loader: 'ts' },
    platform: 'node', format: 'cjs', packages: 'external', bundle: true, write: false,
    plugins: [{ name: 'startup-files-fixture', setup(plugin) {
      plugin.onResolve({ filter: /./ }, args => {
        const key = args.path.split('/').at(-1)!;
        if (mocks[key] && (args.path === 'electron' || !args.path.includes('shared/'))) return { path: key, namespace: 'fixture' };
      });
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: 'const f=globalThis.__startupFiles;' + mocks[args.path] }));
    } }],
  });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const { AssetSyncService, syncLightingResources, resolveModProfile, getDncResourcePath, getShaderResourcePath, getShaderPackRoot } = module.exports;
  AssetSyncService.getAssetsDir = async () => f.assets;
  module.exports.registerMdlHandlers();
  const updateRotatingLighting = f.handlers.get('mdl:update-rotating-lighting')!;
  assert(updateRotatingLighting);
  const q = path.join(f.assets, 'quenching');
  await fs.ensureDir(q);
  await fs.outputFile(path.join(q, 'PostProcessingConfig.txt'), '[AmbientOcclusion]\nEnabled=0\n[Custom]\nKeep=17\n');
  const zip = archiver('zip');
  const output = createWriteStream(path.join(q, 'env-20-30-public.zip'));
  const closed = new Promise<void>((resolve, reject) => { output.on('close', resolve); zip.on('error', reject); output.on('error', reject); });
  zip.pipe(output); zip.append('fresh-env', { name: 'environmentmap/env.dds' }); zip.append('fresh-sky', { name: 'sky/sky.dds' });
  await zip.finalize(); await closed;
  for (const [name, contents] of [['zip-foliage-que.zip', 'que-foliage'], ['zip-foliage-other.zip', 'other-foliage']]) {
    const foliage = archiver('zip');
    const stream = createWriteStream(path.join(q, name));
    const done = new Promise<void>((resolve, reject) => { stream.on('close', resolve); stream.on('error', reject); foliage.on('error', reject); });
    foliage.pipe(stream); foliage.append(contents, { name: 'foliage/grass.dds' });
    await foliage.finalize(); await done;
  }
  const baseline = 'Light "Sun" {\n static Intensity 1.0,\n static AmbIntensity 0.2,\n static ShadowIntensity 0.5,\n}\n';
  for (const version of ['v204', 'v30', 'v301']) for (const graphics of ['hd', 'de']) for (const lighting of ['standard', 'battle', 'rpg']) {
    const settings = { versionSelection: version, graphicsSelection: graphics, lighting };
    const profile = await resolveModProfile(root, settings);
    const shaderSource = getShaderResourcePath(q, profile, lighting);
    const hd = profile.shaderPack.includes('hd');
    const ps = hd ? shaderSource : path.join(shaderSource, 'ps');
    const vs = hd ? path.join(getShaderPackRoot(q, profile), 'vs') : path.join(shaderSource, 'vs');
    for (const name of ['hd', 'sd_on_hd', 'foliage', 'terrain', 'cliffblightmiscterrain', 'fog', 'volumetricfog', 'tonemap', 'bloomextract', 'bloomcombine', 'gaussianblur']) await fs.outputFile(path.join(ps, name + '.bls'), `${profile.shaderPack}/${lighting}/${name}`);
    await fs.outputFile(path.join(vs, 'hd.bls'), 'fresh-vs');
    await fs.outputFile(path.join(getDncResourcePath(q, profile), 'lordaeronsummer', 'lordaeronsummerday.mdl'), baseline);
  }
  for (const variant of ['brightness_1', 'brightness_2', 'brightness_3', 'ao_080', 'ao_066', 'ao_080_outline', 'ao_066_outline']) {
    for (const family of ['fog_shaders', 'fog_shaders-legacy']) for (const name of ['fog', 'volumetricfog']) await fs.outputFile(resourcePath(q, 'shaders', family, variant, 'ps', name + '.bls'), variant);
  }
  for (const pack of ['dnc20', 'dnc30-hd', 'dnc30-de']) {
    await fs.copy(path.resolve('assets/unpacked/dnc', pack), resourcePath(q, 'dnc', pack));
  }
  for (const name of ['terrain', 'cliffblightmiscterrain','hd','sd_on_hd','foliage']) await fs.outputFile(resourcePath(q, 'shaders/fog_shaders/identity_writers/ps', name + '.bls'), 'native-identity');
  for (const channel of ['retail', 'ptr']) {
    f.channel = channel;
    const buildDir = path.join(root, channel === 'ptr' ? '_ptr_' : '_retail_');
    await fs.ensureDir(buildDir);
    const unitSkin = path.join(buildDir, 'units/unitskin.txt');
    await fs.outputFile(unitSkin, '[hfoo]\nfile:hd=cos/custom/retained\nmodelScale:hd=1.5\n[hmtt]\nmodelScale:hd=0.85\n[Hamg]\nmodelScale:hd=1.3\n');
    f.settings = { versionSelection: 'v301', graphicsSelection: 'hd', lighting: 'rpg', lightingBrightness: 4, objectShader: false, postProcessing: true, postProcessingGlow: false, useIntelAmdShaderFix: true };
    const profile = await resolveModProfile(root, f.settings);
    // PTR's pack is distinct; make its small fixture from the matching HD resources.
    if (channel === 'ptr') {
      // PTR now reads these exact Retail sources through the shared alias.
    }
    await fs.outputFile(path.join(buildDir, 'shaders', '.quenching-shader-pack'), profile.shaderPack + '\n');
    await fs.outputFile(path.join(buildDir, 'shaders', 'ps', 'fog.bls'), 'stale-shader');
    await fs.outputFile(path.join(buildDir, 'shaders', 'unknown-old.bls'), 'stale-unmanaged-shader');
    await fs.outputFile(path.join(buildDir, 'environment', '.quenching-public-environment'), 'existing marker');
    await fs.outputFile(path.join(buildDir, 'environment', 'environmentmap', 'env.dds'), 'stale-env');
    await fs.outputFile(path.join(buildDir, 'environment', 'custom', 'player.dds'), 'player');
    await fs.outputFile(path.join(buildDir, 'environment', 'foliage', 'grass.dds'), 'selected-foliage');
    const progress:Array<{step:string;percent:number}>=[];
    await syncLightingResources(root, q, f.settings, undefined, { forceEnvironment: true,
      onProgress:(step:string,percent:number)=>progress.push({step,percent}),
    });
    assert(progress.some(p=>p.step==='shaders'&&p.percent>12&&p.percent<65),'shader file progress');
    assert(progress.some(p=>p.step==='environment'&&p.percent>=65),'environment progress');
    assert(progress.some(p=>p.step==='dnc'&&p.percent>=72),'DNC progress');
    assert(progress.every((p,i)=>p.percent<100&&(i===0||p.percent>=progress[i-1].percent)),'service progress is monotonic; caller owns final completion');
    assert.equal(parseSkinSections(await fs.readFile(unitSkin, 'utf8')).hfoo['modelScale:hd'], '1.5');
    assert.equal(await fs.readFile(path.join(buildDir, 'environment/environmentmap/env.dds'), 'utf8'), 'fresh-env');
    assert.equal(await fs.readFile(path.join(buildDir, 'environment/custom/player.dds'), 'utf8'), 'player');
    assert.equal(await fs.readFile(path.join(buildDir, 'environment/foliage/grass.dds'), 'utf8'), 'que-foliage', 'Split foliage is installed alongside the public environment');
    await fs.writeFile(path.join(buildDir, 'environment/foliage/grass.dds'), 'retained-on-lighting-change');
    await syncLightingResources(root, q, f.settings);
    assert.equal(await fs.readFile(path.join(buildDir, 'environment/foliage/grass.dds'), 'utf8'), 'retained-on-lighting-change', 'Ordinary lighting changes do not re-extract existing foliage');
    await fs.remove(path.join(buildDir, 'environment/foliage'));
    await syncLightingResources(root, q, f.settings);
    assert.equal(await fs.readFile(path.join(buildDir, 'environment/foliage/grass.dds'), 'utf8'), 'que-foliage', 'Existing public marker still repairs missing foliage');
    assert.equal(await fs.readFile(path.join(buildDir,'shaders/ps/hd.bls'),'utf8'),'native-identity');
    assert(!await fs.pathExists(path.join(buildDir, 'shaders/ps/bloomextract.bls')), 'Intel fix must not resurrect disabled glow');
    assert(!await fs.pathExists(path.join(buildDir, 'shaders/unknown-old.bls')));
    const dncFile = path.join(buildDir, 'environment/dnc/lordaeronsummer/lordaeronsummerday.mdl');
    const first = await fs.readFile(dncFile, 'utf8');
    await syncLightingResources(root, q, f.settings, undefined, { forceEnvironment: true });
    assert.equal(await fs.readFile(dncFile, 'utf8'), first, 'Repeated refresh must restore DNC baseline, not compound coefficients');
    const fogFile = path.join(buildDir, 'shaders/ps/fog.bls');
    const oldFog = await fs.readFile(fogFile);
    const sourceFog = resourcePath(q, 'shaders/fog_shaders/ao_080/ps/fog.bls');
    if (channel === 'retail') {
      await fs.rename(sourceFog, sourceFog + '.test-backup');
      await assert.rejects(syncLightingResources(root, q, f.settings, undefined, { forceEnvironment: true }), /Fog shader missing/);
      assert.deepEqual(await fs.readFile(fogFile), oldFog, 'Preparation failure must retain working shaders');
      await fs.rename(sourceFog + '.test-backup', sourceFog);
      const rename = fs.rename;
      let failSwap = true;
      (fs as any).rename = async (from: string, to: string) => {
        if (failSwap && from.includes('.quenching-rendering-') && path.basename(from) === 'shaders') {
          failSwap = false;
          throw new Error('injected shader swap failure');
        }
        return rename(from, to);
      };
      try {
        await assert.rejects(syncLightingResources(root, q, f.settings, undefined, { forceEnvironment: true }), /shader swap failure/);
        assert.deepEqual(await fs.readFile(fogFile), oldFog, 'Failed directory swap must restore previous shaders');
      } finally { (fs as any).rename = rename; }
      let lockedRenames = 0;
      (fs as any).rename = async (from: string, to: string) => {
        if (from === path.join(buildDir, 'shaders')) {
          lockedRenames++;
          throw Object.assign(new Error('injected directory lock'), { code: 'EPERM' });
        }
        return rename(from, to);
      };
      try {
        await fs.outputFile(path.join(buildDir, 'shaders/unknown-old.bls'), 'obsolete');
        await fs.writeFile(fogFile, 'outdated');
        await syncLightingResources(root, q, f.settings, undefined, { forceEnvironment: true });
        assert.equal(lockedRenames, 3, 'Directory lock is retried before falling back');
        assert.deepEqual(await fs.readFile(fogFile), oldFog, 'Directory lock allows individual shader updates');
        assert(!await fs.pathExists(path.join(buildDir, 'shaders/unknown-old.bls')));
        assert(!(await fs.readdir(buildDir)).some(name => name.startsWith('.quenching-rendering-')));
      } finally { (fs as any).rename = rename; }
    }
    f.settings = { versionSelection: 'v301', graphicsSelection: 'de', lighting: 'standard', postProcessing: false, postProcessingGlow: true };
    await syncLightingResources(root, q, f.settings, undefined, { forceEnvironment: true });
    assert(!await fs.pathExists(path.join(buildDir, 'environment/environmentmap')));
    assert(!await fs.pathExists(path.join(buildDir, 'shaders/ps/fog.bls')));
    assert(await fs.pathExists(path.join(buildDir, 'shaders/ps/bloomextract.bls')));
    assert.equal(await fs.readFile(path.join(buildDir, 'environment/custom/player.dds'), 'utf8'), 'player');
    f.settings = { versionSelection: 'v30', graphicsSelection: 'hd', lighting: 'battle', lightingBrightness: 4, terrain: 'v16' };
    await syncLightingResources(root, q, f.settings);
    assert.equal(await fs.readFile(path.join(buildDir, 'environment/foliage/grass.dds'), 'utf8'), 'other-foliage', 'HD restoration recomposes foliage from current settings');
    const battleUnits = parseSkinSections(await fs.readFile(unitSkin, 'utf8'));
    assert.equal(battleUnits.hfoo['modelScale:hd'], '1.5', 'battle lighting alone no longer shrinks units');
    assert.equal(battleUnits.hfoo['file:hd'], 'cos/custom/retained');
    assert.equal(battleUnits.hmtt['modelScale:hd'], '0.85', 'battle lighting alone retains the saved scale');
    assert.equal(battleUnits.Hamg['modelScale:hd'], '1.3');
    assert.equal((await fs.readFile(path.join(buildDir, 'shaders/.quenching-shader-pack'), 'utf8')).trim(), channel === 'ptr' ? 'shaders-ptr-hd' : 'shaders-300-legacy-hd', 'explicit v30 retains its dedicated shader pack on Retail');
    f.settings = { versionSelection: 'v204', graphicsSelection: 'hd', lighting: 'standard', useIntelAmdShaderFix: true };
    await syncLightingResources(root, q, f.settings, undefined, { forceEnvironment: true });
    assert.equal(parseSkinSections(await fs.readFile(unitSkin, 'utf8')).hfoo['modelScale:hd'], '1.5');
    assert.equal((await fs.readFile(path.join(buildDir, 'shaders/.quenching-shader-pack'), 'utf8')).trim(), channel === 'ptr' ? 'shaders-ptr-hd' : 'shaders203');
    assert.equal(await fs.readFile(path.join(buildDir, 'environment/foliage/grass.dds'), 'utf8'), 'que-foliage');
    assert((await fs.readFile(path.join(buildDir, 'PostProcessingConfig.txt'), 'utf8')).includes('Keep=17'));
    // Exercise the real startup/settings sync path with the experiment enabled,
    // including profile, mode and brightness changes after the first application.
    const activeDnc = path.join(buildDir, 'environment/dnc');
    for (const [graphics, lighting, level] of [['hd', 'standard', 3], ['de', 'battle', 5], ['hd', 'rpg', 1]] as const) {
      f.settings = { versionSelection: 'v301', graphicsSelection: graphics, lighting,
        lightingBrightness: level, rotatingLighting: true, hdr: lighting !== 'battle' };
      await syncLightingResources(root, q, f.settings);
      assert.match(await fs.readFile(path.join(buildDir, 'PostProcessingConfig.txt'), 'utf8'),
        new RegExp('\\[Tonemap\\]\\r?\\nEnabled=' + (f.settings.hdr ? '1' : '0')),
        'Full sync follows saved HDR without resetting it on lighting changes');
      const selectedProfile = await resolveModProfile(root, f.settings);
      const selectedSource = getDncResourcePath(q, selectedProfile);
      const unit = ROTATING_UNIT_FILES[0];
      const original = renderDncLighting(await fs.readFile(path.join(selectedSource, unit), 'utf8'),
        path.join(activeDnc, unit), lighting, level, { deMode: graphics === 'de', isVersion30: true });
      const actual = await fs.readFile(path.join(activeDnc, unit), 'utf8');
      assert(Number(unitRotationBlock(actual).match(/Rotation (\d+)/)![1]) >= 49, 'The full rotating track survives ordinary profile synchronization');
      assert.equal(replaceUnitRotation(actual, 'ROTATION'), replaceUnitRotation(original, 'ROTATION'), 'Mode/brightness retained outside Rotation');
      const terrain = 'dnclordaeron/dnclordaeronterrain/dnclordaeronterrain.mdl';
      const terrainExpected = renderDncLighting(await fs.readFile(path.join(selectedSource, terrain), 'utf8'),
        path.join(activeDnc, terrain), lighting, level, { deMode: graphics === 'de', isVersion30: true });
      assert.equal(await fs.readFile(path.join(activeDnc, terrain), 'utf8'), terrainExpected);
      const terrainRotation = (text: string) => text.match(/^[\t ]*Rotation\s+\d+\s*\{[^\r\n]*\r?\n[\s\S]*?^[\t ]*\}/m)?.[0];
      if (lighting === 'battle') assert.match(terrainRotation(terrainExpected)!, /0: \{ 0\.25, 0\.25, 0\.75, 0 \}/);
      else assert.equal(terrainRotation(terrainExpected), terrainRotation(await fs.readFile(path.join(selectedSource, terrain), 'utf8')),
        'Leaving battle restores source terrain rotation, including when rotating units stay enabled');
      await syncLightingResources(root, q, f.settings);
      assert.equal(await fs.readFile(path.join(activeDnc, unit), 'utf8'), actual, 'Repeated startup refresh is idempotent');
      f.settings.rotatingLighting = false;
      await syncLightingResources(root, q, f.settings);
      assert.equal(await fs.readFile(path.join(activeDnc, unit), 'utf8'), original, 'Disabled experiment restores normal sync output');
    }
    // The real IPC writes only the four units; no shader/environment refresh.
    const liveUnit = path.join(activeDnc, ROTATING_UNIT_FILES[0]);
    const beforeToggle = await fs.readFile(liveUnit, 'utf8');
    const shaderStat = await fs.stat(path.join(buildDir, 'shaders/ps/terrain.bls'));
    const terrainPath = path.join(activeDnc, 'dnclordaeron/dnclordaeronterrain/dnclordaeronterrain.mdl');
    const terrainStat = await fs.stat(terrainPath);
    await updateRotatingLighting({}, root, true);
    assert.equal(f.settings.rotatingLighting, true, 'Main process commits preference after applying units');
    assert.notEqual(await fs.readFile(liveUnit, 'utf8'), beforeToggle);
    assert.equal((await fs.stat(path.join(buildDir, 'shaders/ps/terrain.bls'))).mtimeMs, shaderStat.mtimeMs);
    assert.equal((await fs.stat(terrainPath)).mtimeMs, terrainStat.mtimeMs);
    await updateRotatingLighting({}, root, false);
    assert.equal(f.settings.rotatingLighting, false);
    assert.equal(await fs.readFile(liveUnit, 'utf8'), beforeToggle);
    await assert.rejects(updateRotatingLighting({}, root, 'true'), /Invalid rotating lighting/);
    f.enabled = false;
    await updateRotatingLighting({}, root, true);
    assert.equal(f.settings.rotatingLighting, true);
    assert.equal(await fs.readFile(liveUnit, 'utf8'), beforeToggle, 'Disabled branch does not write units');
    f.enabled = true;
    const updateAngle=f.handlers.get('mdl:update-lighting-angle')!;
    const terrainBeforeAngle=await fs.readFile(terrainPath);
    await updateAngle({},root,135);
    assert.equal(f.settings.lightingAngle,135);
    const angledOrbit=await fs.readFile(liveUnit,'utf8');
    const interval=angledOrbit.match(/Interval\s*\{\s*(\d+)\s*,\s*(\d+)\s*\}/)!;
    const dawn=Number(interval[1])+Math.round((Number(interval[2])-Number(interval[1]))/4);
    const dawnKey=unitRotationBlock(angledOrbit).match(new RegExp('\\b'+dawn+':\\s*\\{([^}]+)'))!;
    const direction=lightDirection(dawnKey[1].split(',').map(Number));
    assert(Math.abs(Math.atan2(direction[1],direction[0])*180/Math.PI-135)<1e-8,'angle IPC moves the rotating dawn anchor');
    assert.deepEqual(await fs.readFile(terrainPath),terrainBeforeAngle);
    assert.equal((await fs.stat(path.join(buildDir, 'shaders/ps/terrain.bls'))).mtimeMs,shaderStat.mtimeMs,'angle IPC never syncs shaders');
    await updateRotatingLighting({},root,false);
    await updateAngle({},root,270);
    const angledStatic=await fs.readFile(liveUnit,'utf8');
    await syncLightingResources(root,q,f.settings);
    assert.equal(await fs.readFile(liveUnit,'utf8'),angledStatic,'angle survives ordinary profile/startup synchronization');
    await assert.rejects(updateAngle({},root,361),/Invalid unit lighting angle/);
    assert.equal(f.settings.lightingAngle,270);
    assert.equal(await fs.readFile(liveUnit,'utf8'),angledStatic);
    f.enabled=false;
    await updateAngle({},root,10);
    assert.equal(f.settings.lightingAngle,10);
    assert.equal(await fs.readFile(liveUnit,'utf8'),angledStatic,'parked angle only stores preference');
    f.enabled=true;
  }
  console.log('PASS: actual staged shader/env/DNC writes, split foliage composition/restoration, lighting-only foliage no-op, same-marker refresh, Retail/PTR, HD/DE/2.x, toggle ordering, custom environment retained, coefficient reset and missing-input protection');
} finally {
  assert(path.dirname(root) === taskRoot && path.basename(root).startsWith('startup-files-'));
  assert(!(await fs.lstat(root)).isSymbolicLink());
  await fs.remove(root);
}
