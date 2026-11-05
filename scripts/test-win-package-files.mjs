import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const { getMainFileMatchers, getNodeModuleFileMatcher } = require('app-builder-lib/out/fileMatcher.js');
const { doMergeConfigs } = require('app-builder-lib/out/util/config/config.js');
const root = path.resolve(import.meta.dirname, '..');
const rawConfig = yaml.load(await fs.readFile(path.join(root, 'electron-builder.yml'), 'utf8'));
const fileStat = { isDirectory: () => false };
const dirStat = { isDirectory: () => true };

function filters(config) {
  const out = path.join(root, '__Bin');
  const destination = path.join(out, 'win-unpacked/resources/app');
  const packager = {
    info: { config, projectDir: root, buildResourcesDir: 'build', isPrepackedAppAsar: false, debugLogger: { isEnabled: false } },
    debugLogger: { isEnabled: false },
  };
  const main = getMainFileMatchers(root, destination, value => value, config.win, packager, out, false);
  return {
    accepts: (relative, stat = fileStat) => main.some(matcher => matcher.createFilter()(path.join(root, relative), stat)),
    dependency: getNodeModuleFileMatcher(root, destination, value => value, config.win, packager.info).createFilter(),
  };
}

// Use electron-builder's config normalization and actual matchers. Normalization
// turns shared files into a FileSet, while platform strings form another matcher.
const config = doMergeConfigs([structuredClone(rawConfig)]);
const fixed = filters(config);
const privateFiles = [
  '_tmp/qm-udp-repair-20261028/qm-udp-nic-capture-20261028-032052.xml',
  '_tmp/future-task/transient-file.bin', '_irys/private-tool.ts', '.env',
  '.agents/skills/quenching-release/SKILL.md', 'src/Main/index.ts',
  'scripts/test-win-package-files.mjs', 'backup/original.mdl', 'wiki/local-report.md',
];
for (const file of privateFiles) assert.equal(fixed.accepts(file), false, `Must exclude ${file}`);
for (const dir of ['_tmp', '_irys', 'src', 'scripts', 'backup', 'wiki']) {
  assert.equal(fixed.accepts(dir, dirStat), false, `Must not traverse ${dir}`);
}
for (const file of ['dist/main.js', 'dist/preload.js', 'dist/renderer/index.html', 'package.json', 'release-version.json']) {
  assert.equal(fixed.accepts(file), true, `Missing runtime file ${file}`);
}
for (const file of ['dist/main.js.map', 'dist/statics/image.png']) {
  assert.equal(fixed.accepts(file), false, `Must exclude ${file} from ASAR`);
}
for (const file of [
  'node_modules/7zip-bin-full/win/x64/7z.exe',
  'node_modules/7zip-bin-full/win/x64/7z.dll',
  'node_modules/@jamiephan/stormlib/prebuilds/win32-x64/node.napi.node',
  'node_modules/@jamiephan/casclib/prebuilds/win32-x64/node.napi.node',
]) assert.equal(fixed.dependency(path.join(root, file), fileStat), true, `Missing dependency ${file}`);
for (const file of [
  'node_modules/7zip-bin-full/mac/arm64/7zz',
  'node_modules/7zip-bin-full/linux/x64/7zz',
  'node_modules/7zip-bin-full/win/arm64/7z.exe',
  'node_modules/7zip-bin-full/win/ia32/7z.exe',
  'node_modules/7zip-bin-full/win/x64/7zc/7zc.exe',
  'node_modules/@jamiephan/casclib/prebuilds/linux-x64/native.node',
  'node_modules/@jamiephan/stormlib/prebuilds/darwin-arm64/native.node',
]) assert.equal(fixed.dependency(path.join(root, file), fileStat), false, `Unneeded dependency ${file}`);

// Confirm this regression check detects the original exclusions-only bug.
const broken = structuredClone(rawConfig);
broken.win.files = broken.win.files.filter(value => value !== 'package.json');
assert.equal(filters(doMergeConfigs([broken])).accepts(privateFiles[0]), true);
console.log('PASS: Windows packaging excludes private/temp/source files, keeps runtime/native files, and reproduces the original matcher bug.');

if (process.argv[2]) {
  const asar = require('@electron/asar');
  const entries = asar.listPackage(path.resolve(process.argv[2])).map(name => name.replaceAll('\\', '/').replace(/^\//, ''));
  const roots = [...new Set(entries.map(name => name.split('/')[0]))].sort();
  assert.deepEqual(roots, ['dist', 'node_modules', 'package.json', 'release-version.json']);
  assert(!entries.some(name => /^dist\/statics(?:\/|$)|^dist\/.*\.map$/.test(name)));
  assert(!entries.some(name => /^node_modules\/7zip-bin-full\/(?:mac|linux)\//.test(name)));
  console.log(`PASS: actual ASAR has only runtime roots (${entries.length} entries).`);
}
