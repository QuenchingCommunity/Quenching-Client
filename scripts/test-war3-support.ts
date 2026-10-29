import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resourcePath } from '../src/shared/bundled-resource-paths.mjs';
import { normalizeVersionSelection } from '../src/shared/mod-profile';
import { supportedWar3Version } from '../src/shared/war3-support';

// Actual build.info reader and resource resolver; no real game or registry writes.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'quenching-war3-support-'));
const compiled = await build({
  stdin: { contents: `export { resolveModProfile } from './src/Main/services/mod-profile';
    export { switchGameChannel } from './src/Main/services/game-channel-switch';
    export { detectWar3Version, getUiZipForVersion } from './src/Main/services/war3-version';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
  plugins: [{ name: 'isolated-channel', setup(p) {
    p.onResolve({ filter: /\/(game-channel|config-manager|mod-update-service|branch-mod-toggle)$/ }, a =>
      a.path.includes('shared/') ? undefined : ({ path: a.path, namespace: 'fixture' }));
    p.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents:
      a.path.endsWith('config-manager') ? `export const configManager={set:()=>{throw Error('unexpected settings write')}};`
      : a.path.endsWith('mod-update-service') ? `export const assertWarcraftNotRunning=async()=>{};`
      : a.path.endsWith('branch-mod-toggle') ? `export const BRANCH_MOD_FOLDERS=['shaders'];`
      : `export const getSelectedGameChannel=()=> 'retail'; export const getSelectedGameFolder=()=> '_retail_';
         export const hasGameChannelDirectory=async()=>true;export const getChannelModEnabled=()=>true;
         export const setChannelModEnabled=()=>{throw Error('unexpected branch mutation')};` }));
  } }],
});
const module = { exports: {} as any };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { resolveModProfile, detectWar3Version, getUiZipForVersion, switchGameChannel } = module.exports;
const writeVersion = (version: string) => fs.outputFile(path.join(root, '_retail_', '.build.info'), `Active!DEC:1|Version!STRING:0\n1|${version}\n`);
try {
  for (const [version, tier, pack, ui] of [
    ['2.0.4.24000', 'v204', 'shaders203', 'zip-ui-20.zip'],
    ['3.0', 'v30', 'shaders-300-legacy-hd', 'zip-ui-30.zip'],
    ['3.0.0.24268', 'v30', 'shaders-300-legacy-hd', 'zip-ui-30.zip'],
    ['3.0.1.24368', 'v301', 'shaders-300-hd', 'zip-ui-30.zip'],
    ['3.0.2.24400', 'v301', 'shaders-300-hd', 'zip-ui-30.zip'],
    ['3.1.0.25000', 'v301', 'shaders-300-hd', 'zip-ui-30.zip'],
  ]) {
    await writeVersion(version);
    const profile = await resolveModProfile(root, { versionSelection: 'auto', graphicsSelection: 'hd' });
    assert.equal(profile.version, tier);
    assert.equal(profile.shaderPack, pack);
    assert.equal(getUiZipForVersion(version), ui);
    assert.equal(profile.dncPack, tier === 'v204' ? 'dnc20' : 'dnc30-hd');
  }
  for (const version of ['1.32.0', '1.36.2', '2.0.0', '2.0.1', '2.0.2', '2.0.3', '2.0.5', '2.1.0']) {
    await writeVersion(version);
    for (const selection of ['auto', 'v1', 'v20', 'v203', 'v204', 'v30', 'v301']) {
      for (const graphics of ['sd', 'hd', 'de']) {
        await assert.rejects(resolveModProfile(root, { versionSelection: selection, graphicsSelection: graphics }), /Quenching 3\.7 requires/);
      }
    }
    assert.throws(() => getUiZipForVersion(version), /Quenching 3\.7 requires/);
  }
  assert.equal(normalizeVersionSelection('v203'), 'v204');
  for (const old of ['v1', 'v20', 'invalid']) assert.equal(normalizeVersionSelection(old), 'auto');
  assert.equal(normalizeVersionSelection('v30'), 'v30');
  await writeVersion('3.0.1.24368');
  assert.equal((await resolveModProfile(root, { versionSelection: 'v30', graphicsSelection: 'hd' })).shaderPack, 'shaders-300-legacy-hd', 'explicit 3.0 uses independent legacy pack');
  await writeVersion('3.0.0.24268');
  assert.equal((await resolveModProfile(root, { versionSelection: 'auto', graphicsSelection: 'de' })).shaderPack, 'shaders-300-legacy-de');
  await writeVersion('2.0.4.24000');
  assert.equal((await resolveModProfile(root, { versionSelection: 'v203', graphicsSelection: 'de' })).graphics, 'hd');
  assert.equal((await resolveModProfile(root, { versionSelection: 'v1' })).version, 'v204');
  await fs.outputFile(path.join(root, '.build.info'), 'Active!DEC:1|Version!STRING:0|Product!STRING:0\n1|2.0.3.23000|w3\n1|3.0.1.24368|w3t\n');
  assert.equal((await detectWar3Version(root, 'ptr')).version, '3.0.1.24368', 'explicit destination channel is independent of current selection');
  await fs.outputFile(path.join(root, '_ptr_', '.build.info'), 'Active!DEC:1|Version!STRING:0\n1|2.0.3.23000\n');
  const resource = path.join(root, '_retail_', 'shaders', 'ps', 'custom.bls');
  await fs.outputFile(resource, 'keep current resources');
  await assert.rejects(switchGameChannel(root, 'ptr'), /Quenching 3\.7 requires/);
  assert.equal(await fs.readFile(resource, 'utf8'), 'keep current resources', 'unsupported destination must not move current resources');
  const empty = path.join(root, 'unknown'); await fs.ensureDir(empty);
  await assert.rejects(resolveModProfile(empty), /Quenching 3\.7 requires/);
  assert.equal((await resolveModProfile(empty, { versionSelection: 'v204' })).version, 'v204');
  assert.throws(() => getUiZipForVersion(''), /Quenching 3\.7 requires/);
  assert.equal(getUiZipForVersion('', 'v204'), 'zip-ui-20.zip');
  assert.throws(() => getUiZipForVersion('2.0.3', 'v204'), /Quenching 3\.7 requires/);
  for (const parts of [[], [0], [2, 0, 3], [3, -1, 1], [3, 0, NaN]]) assert.equal(supportedWar3Version(parts), null);
  assert.equal(supportedWar3Version([3, 0, 0]), 'v30');

  const assets = path.resolve('assets/quenching');
  for (const retired of ['shaders136', 'shaders200']) assert.equal(await fs.pathExists(resourcePath(assets, 'shaders', retired)), false);
  for (const pack of ['fog_shaders', 'fog_shaders-legacy', 'readability-301', 'shaders203', 'shaders-300-de', 'shaders-300-hd', 'shaders-ptr-de', 'shaders-ptr-hd', 'shaders-300-legacy-hd', 'shaders-300-legacy-de']) {
    assert(await fs.pathExists(resourcePath(assets, 'shaders', pack)), `Unified expanded source is missing ${pack}`);
  }
  console.log('PASS: 3.7 version policy, old preference migration, manual bypass rejection, branch detection and retired packaged resources');
} finally {
  await fs.remove(root);
}
