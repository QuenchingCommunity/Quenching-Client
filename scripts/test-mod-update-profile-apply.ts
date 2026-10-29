import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const handlers = new Map<string, (...args: any[]) => Promise<any>>();
const calls: string[] = [];
const fixture = {
  handlers,
  calls,
  result: { applied: true, status: { decision: 'patch' } } as { applied: boolean; status: { decision: string }; appliedPatches?: number },
  warnings: ['missing shader pack'],
};
(globalThis as any).__modUpdateProfileFixture = fixture;

const bundled = await build({
  stdin: {
    contents: 'export { registerModUpdateHandlers } from "./src/Main/ipc/mod-update-handlers";',
    resolveDir: process.cwd(), loader: 'ts',
  },
  platform: 'node', format: 'cjs', packages: 'external', bundle: true, write: false,
  plugins: [{ name: 'mod-update-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^(electron)$|(?:config-manager|mod-profile|mod-update-service|mod-integrity-service|game-channel|branch-mod-toggle|post-install-profile)$/ },
      (args) => args.path.includes('shared/') ? undefined : ({ path: args.path, namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
      contents: args.path === 'electron'
        ? 'export const ipcMain = { handle: (name, handler) => globalThis.__modUpdateProfileFixture.handlers.set(name, handler) };'
        : args.path.endsWith('config-manager') ? 'export const configManager={get:()=>({})};'
        : args.path.endsWith('mod-profile') ? 'export const resolveModProfile=async()=>({graphics:"hd"});'
        : args.path.endsWith('mod-update-service')
          ? 'export const getInstalledModState = async () => null; export const getModUpdateStatus = async () => null; export async function applyModUpdate(path, options) { globalThis.__modUpdateProfileFixture.calls.push("patch"); options.onProgress({phase:"complete",percent:100,message:"files done"}); return globalThis.__modUpdateProfileFixture.result; }'
          : args.path.endsWith('mod-integrity-service')
            ? 'export const verifyModIntegrity = async () => null;'
            : args.path.endsWith('game-channel')
              ? 'export const getChannelModEnabled = () => true; export const getSelectedGameChannel = () => "retail"; export const getSelectedGameDir = p => p;'
              : args.path.endsWith('branch-mod-toggle')
                ? 'export const isBranchModDisabled = async () => false;'
                : 'export async function applyInstalledProfile() { globalThis.__modUpdateProfileFixture.calls.push("profile"); return globalThis.__modUpdateProfileFixture.warnings; }',
    }));
  } }],
});
const module = { exports: {} as any };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(
  createRequire(import.meta.url), module, module.exports,
);
module.exports.registerModUpdateHandlers();
const apply = handlers.get('mod-update:apply');
assert.ok(apply);

const progress: Array<{ phase: string; percent: number }> = [];
const event = { sender: { isDestroyed: () => false, send: (_channel: string, value: any) => progress.push(value) } };
const updated = await apply(event, 'game');
assert.equal(updated.applied, true);
assert.equal(updated.configurationError, 'missing shader pack');
assert.deepEqual(calls, ['patch', 'profile']);
assert.deepEqual(progress.map(({ phase, percent }) => [phase, percent]), [['finalizing', 99], ['complete', 100]]);

calls.length = 0;
progress.length = 0;
fixture.result = { applied: false, status: { decision: 'upToDate' } };
const unchanged = await apply(event, 'game');
assert.equal(unchanged.applied, false);
assert.deepEqual(calls, ['patch']);
assert.deepEqual(progress, []);
calls.length = 0;
fixture.result = { applied: false, appliedPatches: 1, status: { decision: 'patch' } };
const partial = await apply(event, 'game');
assert.equal(partial.applied, false);
assert.deepEqual(calls, ['patch', 'profile']);
assert.ok(progress.every(event => event.phase !== 'complete'), 'partial ZIP chain must not announce overall completion');
console.log('PASS: MOD update applies the profile only after a committed patch and reports profile warnings');
