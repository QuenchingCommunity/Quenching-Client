// Exercise the real deletion IPC and bundled package inventories in temporary installs.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import fs from 'fs-extra';
import { build } from 'esbuild';

const fixture = { handlers: new Map(), config: {}, assets: '', running: false };
globalThis.__modDeleteFixture = fixture;
const compiled = await build({
  entryPoints: ['src/Main/ipc/mod-management-handlers.ts'],
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
  plugins: [{ name: 'isolated-mod-delete', setup(plugin) {
    plugin.onResolve({ filter: /^(electron)$|\/(config-manager|asset-sync|mod-update-service)$/ }, args =>
      ({ path: args.path, namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
      args.path === 'electron'
        ? 'export const ipcMain = { handle: (name, handler) => globalThis.__modDeleteFixture.handlers.set(name, handler) };'
        : args.path.endsWith('/config-manager')
          ? 'export const configManager = { get: key => globalThis.__modDeleteFixture.config[key], set: (key, value) => { globalThis.__modDeleteFixture.config[key] = value; } };'
          : args.path.endsWith('/asset-sync')
            ? 'export const AssetSyncService = { getAssetsDir: async () => globalThis.__modDeleteFixture.assets };'
            : 'export async function assertWarcraftNotRunning() { if (globalThis.__modDeleteFixture.running) throw new Error("game is running"); }',
    }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
module.exports.registerModManagementHandlers();
const deleteMod = fixture.handlers.get('mod:delete');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'quenching-delete-ipc-'));
const previousManifest = process.env.QUENCHING_BASELINE_MANIFEST;
delete process.env.QUENCHING_BASELINE_MANIFEST;
fixture.assets = path.join(root, 'assets');
await fs.ensureDir(path.join(fixture.assets, 'quenching'));
try {
  for (const [index, version, channel, parked, marker, phase = 'disabled'] of [
    [0, '3.4', 'retail', '', 'patch/keep.que'],
    [1, '3.4', 'ptr', 'QMoff', null],
    [2, '3.5', 'retail', '', '_patch/keep.que'],
    [3, '3.5', 'ptr', 'QMoff', 'QMoff/_patch/keep.que'],
    [4, '3.5', 'retail', 'QMoff', '_patch/keep.que', 'disabling'],
  ]) {
    const gameRoot = path.join(root, `game-${index}`);
    const selected = path.join(gameRoot, channel === 'ptr' ? '_ptr_' : '_retail_');
    const other = path.join(gameRoot, channel === 'ptr' ? '_retail_' : '_ptr_');
    const manifest = JSON.parse(zlib.gunzipSync(await fs.readFile(`assets/quenching/update-baselines/qmf-${version}.files.json.gz`)));
    // Cover every top-level resource folder with real package paths.
    const samples = [...new Map(manifest.files.map(file => [file.path.split('/')[0], file.path])).values()];
    for (const relative of samples) await fs.outputFile(path.join(selected, parked, relative), 'modified resource');
    await fs.outputFile(path.join(selected, parked, 'PostProcessingConfig.txt'), 'client processing');
    await fs.outputFile(path.join(selected, parked, 'units', 'unitskin.txt'), 'client skin');
    await fs.outputFile(path.join(selected, 'textures', 'player-custom.blp'), 'player');
    await fs.outputFile(path.join(other, 'PostProcessingConfig.txt'), 'other branch');
    if (marker) await fs.outputFile(path.join(selected, marker), `-v${version}-\n`);
    if (parked) await fs.outputJson(path.join(selected, '.quenching', 'branch-toggle.json'), {
      schema: 1, phase, moves: phase === 'disabling' ? samples.map(active => ({ active, parked: `QMoff/${active}` }))
        .filter(move => !['Mac.txt', 'reg.reg', '_manual'].includes(move.active.split('/')[0])) : [],
    });
    fixture.config = { gameChannel: channel, channelModEnabled: { retail: true, ptr: true }, modSettings: { modEnabled: true } };
    const result = await deleteMod(null, gameRoot);
    assert.equal(result.success, true);
    for (const relative of [...samples, 'PostProcessingConfig.txt', 'units/unitskin.txt']) {
      assert.equal(await fs.pathExists(path.join(selected, parked, relative)), false, `${version}: removed ${relative}`);
      assert.equal(await fs.pathExists(path.join(selected, relative)), false, `${version}: never restore ${relative}`);
    }
    assert.equal(await fs.readFile(path.join(selected, 'textures', 'player-custom.blp'), 'utf8'), 'player');
    assert.equal(await fs.readFile(path.join(other, 'PostProcessingConfig.txt'), 'utf8'), 'other branch');
    assert.equal(fixture.config.channelModEnabled[channel], false);
    assert.equal(fixture.config.channelModEnabled[channel === 'ptr' ? 'retail' : 'ptr'], true);
    assert.equal(fixture.config.modSettings.modEnabled, false);
    assert.equal((await fs.readJson(path.join(selected, '.quenching', 'branch-toggle.json'))).phase, 'disabled');
    if (marker) assert.equal(await fs.pathExists(path.join(selected, marker)), false);
    assert.equal((await deleteMod(null, gameRoot)).success, true, 'retry after success');
  }

  // An updated package needs its local inventory, including paths absent from the baselines.
  const updated = path.join(root, 'updated');
  const branch = path.join(updated, '_retail_');
  const relative = 'textures/new-version-only.blp';
  const sha256 = crypto.createHash('sha256').update('new').digest('hex');
  const files = [{ path: relative, size: 3, sha256 }];
  const filesDigest = crypto.createHash('sha256').update(`${relative}\0${3}\0${sha256}\n`).digest('hex');
  await fs.outputFile(path.join(branch, relative), 'new');
  await fs.outputFile(path.join(branch, '_patch', 'keep.que'), '-v3.6-\n');
  await fs.outputFile(path.join(branch, '_patch', 'qmf-3.6.files.json.gz'), zlib.gzipSync(JSON.stringify({
    schema: 1, product: 'quenching-mod', version: '3.6', sequence: 36, files, filesDigest,
  })));
  fixture.config = { gameChannel: 'retail', modSettings: { modEnabled: true } };
  fixture.running = true;
  await assert.rejects(deleteMod(null, updated), /game is running/);
  assert.equal(await fs.readFile(path.join(branch, relative), 'utf8'), 'new');
  assert.equal(fixture.config.modSettings.modEnabled, true);
  fixture.running = false;
  assert.equal((await deleteMod(null, updated)).success, true);
  assert.equal(await fs.pathExists(path.join(branch, relative)), false);
  assert.equal(await fs.pathExists(path.join(branch, '_patch', 'qmf-3.6.files.json.gz')), false);

  // A file error closes the remaining MOD on disk and can be retried safely.
  await fs.outputFile(path.join(branch, relative), 'new');
  await fs.outputFile(path.join(branch, '_patch', 'keep.que'), '-v3.6-\n');
  fixture.config = { gameChannel: 'retail', modSettings: { modEnabled: true } };
  await assert.rejects(deleteMod(null, updated), /文件清单不可用/);
  assert.equal(await fs.readFile(path.join(branch, relative), 'utf8'), 'new');
  assert.equal(fixture.config.modSettings.modEnabled, true, 'preflight failure does not change the switch');
  await fs.outputFile(path.join(branch, '_patch', 'qmf-3.6.files.json.gz'), zlib.gzipSync(JSON.stringify({
    schema: 1, product: 'quenching-mod', version: '3.6', sequence: 36, files, filesDigest,
  })));
  const originalUnlink = fs.unlink;
  fs.unlink = async file => {
    if (file === path.join(branch, relative)) throw new Error('simulated file error');
    return originalUnlink(file);
  };
  try { await assert.rejects(deleteMod(null, updated), /simulated file error/); }
  finally { fs.unlink = originalUnlink; }
  assert.equal(fixture.config.modSettings.modEnabled, false);
  assert.equal(await fs.pathExists(path.join(branch, relative)), false);
  const failedState = await fs.readJson(path.join(branch, '.quenching', 'branch-toggle.json'));
  const parkedCopy = path.join(branch, failedState.moves.find(move => move.active === relative).parked);
  assert.equal(await fs.readFile(parkedCopy, 'utf8'), 'new');
  assert.equal(failedState.phase, 'disabled');
  assert.equal((await deleteMod(null, updated)).success, true);
  assert.equal(await fs.pathExists(parkedCopy), false);
  console.log('Deletion IPC: legacy/current/updated packages, on/off, branch isolation and persistent MOD off passed');
} finally {
  if (previousManifest === undefined) delete process.env.QUENCHING_BASELINE_MANIFEST;
  else process.env.QUENCHING_BASELINE_MANIFEST = previousManifest;
  delete globalThis.__modDeleteFixture;
  await fs.remove(root);
}
