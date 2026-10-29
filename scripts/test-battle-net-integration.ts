// Real launcher and copied map, isolated settings/files and stubbed OS processes.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { readMapName } from '../src/Main/services/map-name';

const parent = path.resolve('_irys/work');
await fs.ensureDir(parent);
const work = await fs.mkdtemp(path.join(parent, 'battle-launch-'));
const sourceMap = path.resolve('assets/unpacked/camp/cfix.w3x');
const hash = (file: string) => fs.readFile(file).then(bytes => crypto.createHash('sha256').update(bytes).digest('hex'));
const originalHash = await hash(sourceMap);
const f = {
  root: path.join(work, '魔兽 & (测试) 🔥'), documents: path.join(work, '用户文档 中文'), appData: path.join(work, 'Library/Application Support'), assets: path.resolve('assets'),
  channel: 'retail', platform: 'win32', detectedVersion: '3.0.0', enabled: true, staleShaders: false, battleAvailable: true, battleStarts: true,
  events: [] as string[], battleChannels: [] as string[], processes: [] as { command: string; args: string[] }[],
};
(globalThis as any).__battleLaunchFixture = f;
const mocks: Record<string, string> = {
  'electron': 'export const app={getPath:k=>k==="appData"?f.appData:f.documents};',
  'game-channel': 'export const getSelectedGameChannel=()=>f.channel,getSelectedGameFolder=()=>f.channel==="ptr"?"_ptr_":"_retail_",hasGameChannelDirectory=async()=>true,getChannelModEnabled=()=>f.enabled;',
  'config-manager': 'export const configManager={get:k=>k==="war3Path"?f.root:{}};',
  'asset-sync': 'export const AssetSyncService={getAssetsDir:async()=>f.assets,syncConfiguredAssets:async()=>{f.events.push("assets");}};',
  'managed-resource-files': 'export const syncBundledResourceFiles=async()=>{};',
  'full-package-service': 'export const isFullPackageInstalled=async()=>true;',
  'mod-profile': 'export const resolveModProfile=async()=>({shaderPack:"hd"});',
  'war3-version': 'export const readShaderPackMarker=async()=>f.staleShaders?"old":"hd"; export const detectWar3Version=async()=>({source:f.detectedVersion?"build.info":"unknown",parts:f.detectedVersion.split(".").map(Number)});',
  'ui-service': 'export const UIService={syncConfiguredUI:async()=>{f.events.push("ui");}};',
  'branch-mod-toggle': 'export const setBranchModEnabledOnDisk=async()=>{f.events.push("off");};',
  'battle-net-launcher': 'export const resolveBattleNetExe=async()=>f.battleAvailable?"fixture-battlenet":null;export const launchViaBattleNet=async(_root,channel)=>{f.battleChannels.push(channel);f.events.push("battlenet");return f.battleAvailable&&f.battleStarts;};',
  'child_process': 'import {EventEmitter} from "node:events";export const spawn=(command,args)=>{f.events.push("direct");f.processes.push({command,args});const child=new EventEmitter();child.unref=()=>{};setImmediate(()=>child.emit("spawn"));return child;};',
};
try {
  for (const channel of ['_retail_', '_ptr_']) {
    await fs.outputFile(path.join(f.root, channel, 'x86_64/Warcraft III.exe'), 'never executed');
    await fs.ensureDir(path.join(f.root, channel, 'Warcraft III.app'));
    await fs.ensureDir(path.join(f.root, channel, 'x86_64/Warcraft III.app'));
  }
  const r = await build({ entryPoints: ['src/Main/services/game-launcher.ts'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
    plugins: [{ name: 'no-game-no-registry', setup(p) {
      p.onResolve({ filter: /.*/ }, a => {
        const key = a.path.replace(/^\.\//, '');
        return key in mocks ? { path: key, namespace: 'fixture' } : undefined;
      });
      p.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: 'const f=globalThis.__battleLaunchFixture;' + mocks[a.path] }));
    } }],
  });
  const module = { exports: {} as any };
  const runtime = { platform: 'win32', env: { PROGRAMDATA: process.env.PROGRAMDATA }, cwd: () => process.cwd(), pid: process.pid };
  new Function('require', 'module', 'exports', 'process', r.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, runtime);
  const { GameLauncher } = module.exports;
  const reset = () => { f.events=[]; f.battleChannels=[]; f.processes=[]; f.channel='retail'; f.platform='win32'; runtime.platform='win32'; f.detectedVersion='3.0.0'; f.enabled=true; f.staleShaders=false; f.battleAvailable=true; f.battleStarts=true; };
  reset(); await GameLauncher.launchGame(); assert.deepEqual(f.events, ['ui', 'battlenet']);
  reset(); f.staleShaders=true; await GameLauncher.launchGame(); assert.deepEqual(f.events, ['assets', 'ui', 'battlenet']);
  reset(); f.enabled=false; await GameLauncher.launchGame(); assert.deepEqual(f.events, ['off', 'battlenet']);
  reset(); f.battleStarts=false; await GameLauncher.launchGame(); assert.deepEqual(f.events, ['ui', 'battlenet', 'direct']);
  reset(); f.battleAvailable=false; await GameLauncher.launchGame(); assert.deepEqual(f.events, ['ui', 'battlenet', 'direct']);
  reset(); await GameLauncher.launchGame(path.join(f.root, '_retail_/x86_64/Warcraft III.exe')); assert.deepEqual(f.events, ['ui', 'direct']);
  reset(); f.channel='ptr'; await GameLauncher.launchGame(); assert.deepEqual(f.events, ['ui', 'battlenet']); assert.deepEqual(f.battleChannels,['ptr']);
  reset(); f.platform='darwin'; runtime.platform='darwin'; await GameLauncher.launchGame(); assert.deepEqual(f.events, ['ui', 'battlenet']);
  reset(); f.platform='darwin'; runtime.platform='darwin'; f.battleStarts=false; await GameLauncher.launchGame(); assert.deepEqual(f.events,['ui','battlenet','direct']); assert.equal(f.processes[0].command,'open');
  reset(); await GameLauncher.launchMap(path.join(work, '自定义地图.w3x'), 2); assert.deepEqual(f.events, ['ui', 'direct']); assert.ok(f.processes[0].args.includes('-loadfile'));
  for (const version of ['1.36.2', '2.0.0', '2.0.4', '']) {
    reset(); f.detectedVersion=version;
    await GameLauncher.launchGame(); assert.deepEqual(f.events, ['ui', 'direct'], `old/unknown ${version} retains direct launch`);
    assert.equal(await GameLauncher.getCampaignUnlockMode(), 'direct');
    f.events=[]; await GameLauncher.unlockCampaign(); assert.deepEqual(f.events, ['ui', 'direct']);
    assert.ok(f.processes.at(-1)!.args.includes('-loadfile'));
    assert.equal(await fs.pathExists(path.join(f.documents, 'Warcraft III/Maps/Quenching/cfix.w3x')), false);
  }
  reset(); f.detectedVersion='3.0.2'; await GameLauncher.launchGame(); assert.deepEqual(f.events, ['ui', 'battlenet']);

  reset(); assert.equal(await GameLauncher.getCampaignUnlockMode(), 'battlenet');
  await GameLauncher.unlockCampaign('Quenching：战役解锁');
  assert.deepEqual(f.events, ['ui', 'battlenet']);
  const userMap = path.join(f.documents, 'Warcraft III/Maps/Quenching/cfix.w3x');
  const inspectedMap = path.join(work, 'inspect-map.w3x');
  await fs.copyFile(userMap, inspectedMap);
  assert.equal(readMapName(inspectedMap), 'Quenching：战役解锁');
  assert.equal(await hash(sourceMap), originalHash);
  reset(); f.enabled=false; await GameLauncher.unlockCampaign('Quenching：战役解锁'); assert.deepEqual(f.events, ['off', 'battlenet']);
  reset(); f.battleStarts=false; await GameLauncher.unlockCampaign('Quenching：战役解锁'); assert.deepEqual(f.events, ['ui', 'battlenet', 'direct']); assert.ok(f.processes[0].args.includes('-loadfile'));
  for (const platform of ['win32','darwin']) for (const channel of ['retail','ptr']) {
    reset(); f.platform=platform; runtime.platform=platform; f.channel=channel;
    assert.equal(await GameLauncher.getCampaignUnlockMode(),'battlenet');
    await GameLauncher.unlockCampaign('Quenching：战役解锁'); assert.deepEqual(f.events,['ui','battlenet']); assert.deepEqual(f.battleChannels,[channel]);
    const mapsRoot=platform==='darwin'?path.join(f.appData,'Blizzard'):f.documents;
    const gameName=channel==='ptr'?'Warcraft III Public Test':'Warcraft III';
    const copy=path.join(mapsRoot,gameName,'Maps/Quenching/cfix.w3x'); await fs.copyFile(copy,inspectedMap);
    assert.equal(readMapName(inspectedMap),'Quenching：战役解锁');
    f.events=[]; f.detectedVersion='2.0.4'; assert.equal(await GameLauncher.getCampaignUnlockMode(),'direct');
    await GameLauncher.launchGame(); assert.deepEqual(f.events,['ui','direct']);
  }
  reset(); f.assets=path.join(work, 'missing-assets'); await assert.rejects(()=>GameLauncher.unlockCampaign(), /not found/); assert.ok(!f.events.includes('battlenet')); assert.ok(!f.events.includes('direct'));
  assert.equal(await hash(sourceMap), originalHash);
  console.log('PASS: Windows/Mac Retail/PTR 3.0+ routing; older/unknown direct fallback; sync before launch; disabled MOD; launch failures; explicit exe/maps; per-platform/branch copied map paths; source unchanged; no real game or registry used');
} finally {
  delete (globalThis as any).__battleLaunchFixture;
  if (path.dirname(work)!==parent || !path.basename(work).startsWith('battle-launch-')) throw new Error('unsafe fixture cleanup');
  await fs.remove(work);
}
