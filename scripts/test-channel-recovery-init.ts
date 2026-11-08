import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const fixture = {
  gamePath: 'D:/fixture/Warcraft III', fail: '', quit: 0, messages: [] as string[],
  recovered: [] as string[], updated: [] as unknown[],
};
(globalThis as any).__channelRecoveryFixture = fixture;
const mocks: Record<string, string> = {
  electron: 'export const app={whenReady:async()=>{},quit:()=>f.quit++}; export const dialog={showErrorBox:(title,body)=>f.messages.push(title+"\\n"+body)};',
  'config-manager': 'export const configManager={get:()=>f.gamePath};',
  'game-channel-switch': 'export const assertNoInterruptedLegacyChannelSwitch=async()=>{if(f.fail==="legacy")throw Error("An old channel-move journal exists");};',
  'game-channel': 'export const getChannelModEnabled=()=>false;export const setChannelModEnabled=(...args)=>f.updated.push(args);',
  'branch-package-copy': 'export const assertNoPendingBranchCopy=async()=>{if(f.fail==="copy")throw Error("An interrupted branch copy needs manual inspection");};',
  'branch-mod-toggle': 'export const recoverBranchModToggleAtStartup=async(build,enabled)=>{if(f.fail==="toggle")throw Error("EPERM: permission denied, rename");f.recovered.push(build);return build.includes("_retail_")?false:true;};',
  'fs-extra': 'export default {pathExists:async()=>true};',
};
const bundled = await build({
  entryPoints: ['src/Main/services/channel-recovery-init.ts'],
  platform: 'node', format: 'cjs', packages: 'external', bundle: true, write: false,
  plugins: [{ name: 'startup-environment', setup(plugin) {
    plugin.onResolve({ filter: /^(electron|fs-extra)$|\/(config-manager|game-channel-switch|game-channel|branch-package-copy|branch-mod-toggle)$/ }, args =>
      args.path.includes('/shared/') ? undefined : ({ path: args.path.split('/').at(-1)!, namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: 'const f=globalThis.__channelRecoveryFixture;' + mocks[args.path] }));
  } }],
});
function start(): Promise<void> {
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports.channelRecoveryReady;
}
const originalError = console.error;
console.error = () => {};
try {
  await start();
  assert.equal(fixture.recovered.length, 2);
  assert.deepEqual(fixture.updated, [['retail', false], ['ptr', true]]);
  assert.equal(fixture.quit, 0);
  const stages = [
    ['legacy', '.quenching-channel-switch.json', '旧版分支切换'],
    ['copy', 'branch-copy.json', '分支复制'],
    ['toggle', 'branch-toggle.json', 'MOD 开关'],
  ];
  for (const [fail, file, step] of stages) {
    fixture.fail = fail;
    fixture.recovered.length = 0;
    fixture.updated.length = 0;
    await assert.rejects(start());
    const message = fixture.messages.at(-1)!;
    assert(message.includes(file), message);
    assert(message.includes(step), message);
    assert(message.includes('Warcraft III'), message);
    assert(message.includes(fail === 'toggle' ? 'EPERM' : 'journal') || message.includes('interrupted branch copy'), message);
    assert.deepEqual(fixture.updated, []);
  }
  assert.equal(fixture.quit, 3, 'failed recovery must not open an unprotected client');
  fixture.gamePath = '';
  await start();
  assert.equal(fixture.quit, 3, 'first launch with no game path remains usable');
} finally {
  console.error = originalError;
  delete (globalThis as any).__channelRecoveryFixture;
}
console.log('PASS: both branches recovered; legacy/copy/toggle failures show step, path and cause; failures stay blocked; unconfigured startup');
