import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const calls: string[] = [];
const fixture = {
  failSync: false,
  syncOutcome: 'applied',
  async sync(_path: string, _progress: unknown, options: { forceUi?: boolean }) {
    assert.equal(options.forceUi, true, 'package installation must reapply UI even when the previous style marker remains');
    calls.push('profile');
    if (fixture.failSync) throw new Error('missing shader pack');
    return fixture.syncOutcome;
  },
  async blight(_path: string, settings: any) {
    assert.equal(settings.lighting, 'rpg');
    calls.push('blight');
  },
  async skin(_path: string, options: { force?: boolean }) {
    calls.push(`skin:${options.force === true}`);
  },
  restore() { calls.push('restore'); },
};
(globalThis as any).__postInstallProfileFixture = fixture;

const bundled = await build({
  stdin: {
    contents: 'export { applyInstalledProfile } from "./src/Main/services/post-install-profile";',
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  platform: 'node', format: 'cjs', packages: 'external', bundle: true, write: false,
  plugins: [{ name: 'post-install-fixture', setup(plugin) {
    plugin.onResolve({ filter: /(?:asset-sync|blight-service|config-manager|version-skin-service)$/ },
      (args) => ({ path: args.path, namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
      contents: args.path.endsWith('asset-sync')
        ? 'export const AssetSyncService = { syncConfiguredAssets: (...args) => globalThis.__postInstallProfileFixture.sync(...args), refreshUnitSkinBaseline: (...args) => globalThis.__postInstallProfileFixture.skin(...args) };'
        : args.path.endsWith('version-skin-service')
          ? 'export const versionSkinService = { restoreSelections: async () => { globalThis.__postInstallProfileFixture.restore(); return []; } };'
        : args.path.endsWith('blight-service')
          ? 'export const syncBlightOnStartup = (...args) => globalThis.__postInstallProfileFixture.blight(...args);'
          : 'export const configManager = { get: () => ({ lighting: "rpg" }) };',
    }));
  } }],
});
const module = { exports: {} as any };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(
  createRequire(import.meta.url), module, module.exports,
);
const { applyInstalledProfile } = module.exports;

assert.deepEqual(await applyInstalledProfile('game', { forceUnitSkinBaseline: true }), []);
assert.deepEqual(calls, ['profile', 'blight', 'skin:true', 'restore']);

calls.length = 0;
fixture.failSync = true;
const warnings = await applyInstalledProfile('game');
assert.equal(warnings.length, 1);
assert.match(warnings[0], /missing shader pack/);
assert.deepEqual(calls, ['profile', 'blight', 'skin:false', 'restore']);

calls.length = 0;
fixture.failSync = false;
fixture.syncOutcome = 'package-missing';
const skippedWarnings = await applyInstalledProfile('game');
assert.match(skippedWarnings[0], /未识别到完整资源包/);
assert.deepEqual(calls, ['profile']);
calls.length = 0;
assert.deepEqual(await applyInstalledProfile('game', { restoreSkinsOnly: true }), []);
assert.deepEqual(calls, ['restore'], 'MOD-off installation restores parked choices without running rendering/profile changes');
console.log('PASS: installed profile is reapplied, and partial failures are reported without skipping other settings');
