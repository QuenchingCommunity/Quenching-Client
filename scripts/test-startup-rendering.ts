import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { StartupResourceBarrier, guardStartupResourceHandlers, isStartupResourceOperation } from '../src/Main/services/startup-resource-barrier';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const barrier = new StartupResourceBarrier();
const events: string[] = [];
const before = deferred(), background = deferred();
const first = barrier.foreground(async () => { events.push('foreground-before'); await before.promise; });
const refresh = barrier.exclusive(async () => { events.push('startup'); await background.promise; });
const after = barrier.foreground(() => { events.push('foreground-after'); });
await turn();
assert.deepEqual(events, ['foreground-before']);
before.resolve(); await first; await turn();
assert.deepEqual(events, ['foreground-before', 'startup']);
background.resolve(); await Promise.all([refresh, after]);
assert.deepEqual(events, ['foreground-before', 'startup', 'foreground-after']);
await assert.rejects(barrier.exclusive(() => { throw Error('failure'); }), /failure/);
await barrier.foreground(() => events.push('released-after-failure'));
for (const channel of ['mod:install-full-package', 'mod-update:apply', 'config:set', 'shader:update-intel-amd', 'game:switch-channel', 'game:launch', 'third-party:import-zip', 'file:move-directory']) assert(isStartupResourceOperation(channel), channel);
for (const channel of ['config:get', 'window:close', 'mod:get-full-package-status', 'model:read-resource', 'mod-update:get-status']) assert(!isStartupResourceOperation(channel), channel);
const handlers = new Map<string, Function>();
const fakeIpc = { handle(channel: string, listener: Function) { handlers.set(channel, listener); } };
const original = fakeIpc.handle;
guardStartupResourceHandlers(fakeIpc as any, () => fakeIpc.handle('shader:update-object', async () => 7));
assert.equal(fakeIpc.handle, original);
assert.equal(await handlers.get('shader:update-object')!({}), 7);
assert.throws(() => guardStartupResourceHandlers(fakeIpc as any, () => { throw Error('registration'); }));
assert.equal(fakeIpc.handle, original);

const fixture = {
  enabled: true, thirdParty: false, running: false, legacy: false, branch: true, fail: false,
  path: 'D:/test/Warcraft III', channel: 'retail', settings: { graphicsSelection: 'hd', versionSelection: 'v204', lighting: 'rpg' } as any,
  calls: [] as any[], uiSyncs: 0,
};
(globalThis as any).__startupRenderingFixture = fixture;
const mocks: Record<string, string> = {
  'config-manager': 'export const configManager={get:key=>key==="war3Path"?f.path:f.settings};',
  'game-channel': 'export const getSelectedGameChannel=()=>f.channel; export const getChannelModEnabled=()=>f.enabled; export const hasGameChannelDirectory=async()=>f.branch;',
  'third-party-resources': 'export const isThirdPartyQuenchingPaused=async()=>f.thirdParty;',
  'mod-integrity-service': 'export const readCurrentModVersion=async()=>f.legacy?null:"3.5";',
  'mod-update-service': 'export const getInstalledModState=async()=>({sequence:f.legacy?34:35});export const assertWarcraftNotRunning=async()=>{throw Error("Unexpected process query for local assets");};',
  'asset-sync': 'export const AssetSyncService={getAssetsDir:async()=>"assets"};export const syncLightingResources=async(...args)=>{if(f.fail)throw Error("missing shader");f.calls.push(args);};',
  'ui-service': 'export const UIService={syncConfiguredUI:async()=>{f.uiSyncs++;return true;}};',
};
const bundled = await build({
  stdin: { contents: 'export * from "./src/Main/services/startup-rendering";', resolveDir: process.cwd(), loader: 'ts' },
  platform: 'node', format: 'cjs', packages: 'external', bundle: true, write: false,
  plugins: [{ name: 'startup-fixture', setup(plugin) {
    plugin.onResolve({ filter: /(?:config-manager|game-channel|third-party-resources|mod-integrity-service|mod-update-service|asset-sync|ui-service)$/ }, args => ({ path: args.path.split('/').at(-1)!, namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: 'const f=globalThis.__startupRenderingFixture;' + mocks[args.path] }));
  } }],
});
const module = { exports: {} as any };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { applyStartupRendering, scheduleStartupRendering } = module.exports;
assert.equal((await applyStartupRendering()).status, 'applied');
assert.equal(fixture.uiSyncs, 1, 'startup owns the UI refresh removed from settings reads');
assert.equal(fixture.calls[0][4].forceEnvironment, true);
assert.equal(fixture.calls[0][2].versionSelection, 'v204');
fixture.channel = 'ptr'; fixture.settings = { graphicsSelection: 'de', lighting: 'battle' };
assert.equal((await applyStartupRendering()).status, 'applied');
fixture.running=true;
assert.equal((await applyStartupRendering()).status,'applied','local deployment does not inspect the running game');
fixture.running=false;
for (const [key, value, reason] of [['enabled', false, 'mod-disabled-or-no-directory'], ['thirdParty', true, 'third-party-paused'], ['legacy', true, 'legacy-package'], ['branch', false, 'branch-missing']] as const) {
  const old = fixture[key]; (fixture as any)[key] = value;
  assert.equal((await applyStartupRendering()).reason, reason);
  (fixture as any)[key] = old;
}
fixture.settings = { graphicsSelection: 'sd' };
assert.equal((await applyStartupRendering()).reason, 'classic-mode');
fixture.settings = { graphicsSelection: 'hd', classicMode: true };
assert.equal((await applyStartupRendering()).reason, 'classic-mode');
fixture.settings = { graphicsSelection: 'hd' }; fixture.fail = true;
assert.equal((await applyStartupRendering()).status, 'failed');
fixture.fail = false;
const delivered: any[] = [];
const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (_channel: string, result: any) => delivered.push(result) } };
const count = fixture.calls.length;
scheduleStartupRendering(window); scheduleStartupRendering(window);
assert.equal(fixture.calls.length, count, 'Scheduling must return without starting a write');
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(fixture.calls.length, count + 1);
assert.equal(delivered[0].status, 'applied');
console.log('PASS: post-window scheduling, enabled-only rendering without full-package gate, skip guards, error isolation, once-per-process and foreground/startup exclusion');
