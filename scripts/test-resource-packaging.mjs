import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { isDistributableAsset } from '../src/shared/bundled-resource-paths.mjs';
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const { getFileMatchers } = require('app-builder-lib/out/fileMatcher.js');
const { doMergeConfigs } = require('app-builder-lib/out/util/config/config.js');
const root = path.resolve('.');
const config = doMergeConfigs([yaml.load(await fs.readFile('electron-builder.yml', 'utf8'))]);
const matchers = getFileMatchers(config, 'extraResources', path.join(root, '__Bin/test/resources'), {
  macroExpander: value => value, customBuildOptions: config.win, globalOutDir: path.join(root, '__Bin'), defaultSrc: root,
});
const assets = matchers.find(matcher => matcher.from === path.join(root, 'assets'));
assert(assets);
const accepts = (relative, dir = false) => assets.createFilter()(path.join(root, 'assets', relative), { isDirectory: () => dir });
for (const relative of ['quenching/ui-misc.txt', 'quenching/1.ico', 'quenching/logo.png', 'quenching/resources-core.7z', 'quenching/resources-ui.7z', 'quenching/resources-terrain.7z', 'quenching/resources-foliage-color.7z', 'quenching/resources-foliage-detail.7z', 'quenching/resources.manifest.json',
  'quenching/update-public-key.pem', 'quenching/update-baselines/qmf-3.5.files.json.gz', 'fonts/font.otf', 'updater/zstd.exe']) {
  assert.equal(accepts(relative), true, `Windows lost bootstrap/resource ${relative}`);
  assert.equal(isDistributableAsset(relative), true, `Mac lost bootstrap/resource ${relative}`);
}
for (const relative of ['unpacked', 'backup', 'quenching/shaders', 'quenching/skin', 'quenching/camp']) {
  assert.equal(accepts(relative, true), false, `Must not scan ${relative}`);
  assert.equal(isDistributableAsset(relative), false);
}
for (const relative of ['offline.exe','tools/Offline.EXE','quenching/offline.exe','quenching/resources.7z', 'quenching/resources-bogus.7z', 'unpacked/shaders/file.bls', 'quenching/shaders/pack/ps/hd.bls', 'quenching/shaders.zip',
  'quenching/shaders-300-legacy.zip', 'quenching/zip-ui-pub.zip', 'quenching/zip-foliage-que.zip', 'quenching/.vs/private', 'backup/test.bin']) {
  assert.equal(accepts(relative), false, `Windows included raw/old resource ${relative}`);
  assert.equal(isDistributableAsset(relative), false, `Mac included raw/old resource ${relative}`);
}
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
for (const name of ['electron', 'start', 'build', 'pack']) assert(pkg.scripts[name].includes('prepare-client-assets.mjs'), `${name} bypasses resource preparation`);
for (const [name, command] of Object.entries(pkg.scripts).filter(([name]) => name.startsWith('dist:'))) {
  assert(command.includes('npm run build') || command.includes('npm run dist:mac:app') || command.includes('npm run dist:win'), `${name} bypasses the shared build pipeline`);
}
assert((await fs.readFile('scripts/check-mac-native-before-pack.cjs', 'utf8')).includes('prepareClientAssets'));
console.log('PASS: actual Windows filters and Mac policy exclude loose sources/old ZIPs, retain startup icons/update tools, and all launch/build/dist entry points prepare the unified bundle. No client package was built.');
