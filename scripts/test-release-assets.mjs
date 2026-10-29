import { resourcePath } from '../src/shared/bundled-resource-paths.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { prepareReleaseAssets, renderWebUI, UI_ARCHIVES, updateUiVersionText } from './prepare-release-assets.mjs';
import { UI_PUBLIC_ARCHIVE } from './split-ui-archives.mjs';
import { releaseLabel } from './lib/release-label.mjs';

const taskRoot = path.resolve('_tmp/ui-que-version-20261027');
await fs.mkdir(taskRoot, { recursive: true });
const work = await fs.mkdtemp(path.join(taskRoot, 'release-assets-'));
const q = path.join(work, 'assets/quenching');
const template = await fs.readFile('scripts/templates/quenching-webui.html', 'utf8');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const versionedPaths = ['ui-que/framedef/ui/commandbar.fdf', 'ui-que/framedef/backup/commandbar.fdf',
  'framedef/ui/commandbar.fdf', 'framedef/backup/commandbar.fdf'];
const originalFrame = '\uFEFFFrame "SIMPLEFRAME" "CommandBarFrame" {\r\n String "QuenchingVersionText" {\r\n  Font "MasterFont", 0.01,\r\n  Text "V3.5",\r\n }\r\n}\r\n';
const expectedFrame = version => originalFrame.replace('"CommandBarFrame" {', '"CommandBarFrame" {\r\n\tDecorateFileNames,').replace('V3.5', `V${version}`);
try {
  assert.throws(() => updateUiVersionText(originalFrame.replace('V3.5', 'V3.7 TEST'), '3.7 TEST', true), /needs DecorateFileNames/,
    'Correct version text with an unresolved font must fail the release gate');
  assert.throws(() => updateUiVersionText(originalFrame.replace('V3.5', 'V3.7 TEST').replace('  Font', '  DecorateFileNames,\r\n  Font'), '3.7 TEST', true),
    /needs DecorateFileNames/, 'Decoration on the String itself cannot substitute for the parent setting');
  assert.throws(() => updateUiVersionText(originalFrame.replace('  Font "MasterFont", 0.01,\r\n', ''), '3.7 TEST'), /must define its MasterFont/);
  assert.throws(() => updateUiVersionText(originalFrame.replace('"CommandBarFrame"', '"WrongParent"'), '3.7 TEST'), /CommandBarFrame parent/);
  await fs.mkdir(path.join(work, 'scripts/templates'), { recursive: true });
  await fs.writeFile(path.join(work, 'scripts/templates/quenching-webui.html'), template);
  await fs.mkdir(resourcePath(q, 'tx'), { recursive: true });
  await fs.writeFile(path.join(work, 'package.json'), '{"version":"3.7.1"}');
  await fs.writeFile(path.join(work, 'release-version.json'), '{"displayVersion":"3.7"}');
  for (const name of ['QuenchingOnCN.png', 'QuenchingOnEN.png']) await fs.writeFile(resourcePath(q, 'tx', name), 'versionless-' + name);
  const imageHashes = await Promise.all(['QuenchingOnCN.png', 'QuenchingOnEN.png'].map(async n => hash(await fs.readFile(resourcePath(q, 'tx', n)))));
  const publicZip = new JSZip();
  publicZip.file('ui-que/console/image.bin', Buffer.from([0, 255, 17, 88, 128]));
  const publicBytes = await publicZip.generateAsync({ type: 'nodebuffer' });
  await fs.writeFile(path.join(q, UI_PUBLIC_ARCHIVE), publicBytes);
  for (const name of UI_ARCHIVES) {
    const zip = new JSZip();
    for (const file of versionedPaths) zip.file(file, originalFrame);
    zip.file('ui-blz/framedef/ui/commandbar.fdf', 'Text "Keep unrelated UI unchanged",');
    await fs.writeFile(path.join(q, name), await zip.generateAsync({ type: 'nodebuffer' }));
  }
  const latestRoot = path.join(work, 'Latest');
  const first = await prepareReleaseAssets({ root: work, latestRoot });
  assert.deepEqual(first.ui.map(item => item.changedFiles), [4, 4]);
  const html = await fs.readFile(path.join(q, 'index.html'), 'utf8');
  assert.match(html, /data-quenching-version="3\.7"/);
  assert.match(html, /Version 3\.7 By 天下正义/);
  assert.doesNotMatch(html, /\{\{QUENCHING_DISPLAY_VERSION\}\}/);
  assert.equal(await fs.readFile(path.join(latestRoot, 'webui/index.html'), 'utf8'), html);
  assert.equal(await fs.readFile(path.join(latestRoot, 'webui/QuenchingOn.png'), 'utf8'), 'versionless-QuenchingOnCN.png');
  const archiveHashes = [];
  for (const name of UI_ARCHIVES) {
    const data = await fs.readFile(path.join(q, name)); archiveHashes.push(hash(data));
    const zip = await JSZip.loadAsync(data);
    for (const file of versionedPaths) assert.equal(await zip.file(file).async('string'), expectedFrame('3.7'));
    assert(!zip.file('ui-que/console/image.bin'), 'Textures stay in the shared package');
    assert.equal(await zip.file('ui-blz/framedef/ui/commandbar.fdf').async('string'), 'Text "Keep unrelated UI unchanged",');
  }
  assert.equal((await prepareReleaseAssets({ root: work, latestRoot, check: true })).htmlChanged, false);
  const again = await prepareReleaseAssets({ root: work, latestRoot });
  assert.equal(again.htmlChanged, false); assert.deepEqual(again.ui.map(item => item.changedFiles), [0, 0]);
  assert.deepEqual(await Promise.all(UI_ARCHIVES.map(async n => hash(await fs.readFile(path.join(q, n))))), archiveHashes);
  assert.deepEqual(await fs.readFile(path.join(q, UI_PUBLIC_ARCHIVE)), publicBytes, 'Version updates must never rewrite shared assets');
  const savedVariant = await fs.readFile(path.join(q, UI_ARCHIVES[0]));
  const invalidVariant = await JSZip.loadAsync(savedVariant);
  invalidVariant.file('misplaced.dds', 'texture');
  await fs.writeFile(path.join(q, UI_ARCHIVES[0]), await invalidVariant.generateAsync({ type: 'nodebuffer' }));
  await assert.rejects(prepareReleaseAssets({ root: work, check: true }), /only version-specific FDF/);
  await fs.writeFile(path.join(q, UI_ARCHIVES[0]), savedVariant);
  await fs.writeFile(path.join(work, 'package.json'), '{"version":"3.8.0"}');
  await fs.writeFile(path.join(work, 'release-version.json'), '{"displayVersion":"3.8"}');
  await assert.rejects(prepareReleaseAssets({ root: work, check: true }), /expected V3.8/);
  assert.equal(await fs.readFile(path.join(q, 'index.html'), 'utf8'), html, 'read-only check cannot alter the old output');
  await prepareReleaseAssets({ root: work, latestRoot });
  assert.match(await fs.readFile(path.join(q, 'index.html'), 'utf8'), /Version 3\.8 By/);
  await fs.writeFile(path.join(work, 'release-version.json'), '{"displayVersion":"3.8","channel":"test"}');
  await assert.rejects(prepareReleaseAssets({ root: work, check: true }), /expected V3.8 TEST/);
  await prepareReleaseAssets({ root: work, latestRoot });
  const testHtml = await fs.readFile(path.join(q, 'index.html'), 'utf8');
  assert.match(testHtml, /Version 3\.8 TEST By/);
  assert.match(testHtml, /<title>Quenching 3\.8 TEST UI<\/title>/);
  for (const archive of UI_ARCHIVES) {
    const zip = await JSZip.loadAsync(await fs.readFile(path.join(q, archive)));
    for (const file of versionedPaths) assert.equal(await zip.file(file).async('string'), expectedFrame('3.8 TEST'));
  }
  assert.equal(JSON.parse(await fs.readFile(path.join(q, 'local-release.json'), 'utf8')).channel, 'test');
  assert.equal(await fs.readFile(path.join(q, 'local-release.json'), 'utf8'), await fs.readFile(path.join(latestRoot, 'local-release.json'), 'utf8'));
  assert.equal((await prepareReleaseAssets({ root: work, latestRoot, check: true })).label, '3.8 TEST');
  assert.equal(releaseLabel({ displayVersion: '3.7', channel: 'test' }), '3.7 TEST');
  assert.throws(() => releaseLabel({ displayVersion: '3.7', channel: 'typo' }), /Invalid local/);
  assert.deepEqual(await Promise.all(['QuenchingOnCN.png', 'QuenchingOnEN.png'].map(async n => hash(await fs.readFile(resourcePath(q, 'tx', n))))), imageHashes, 'a release change never regenerates the PNGs');
  await fs.writeFile(path.join(work, 'package.json'), '{"version":"3.9.0"}');
  await assert.rejects(prepareReleaseAssets({ root: work }), /different releases/);
  assert.throws(() => renderWebUI(template, '<script>bad</script>'), /Invalid/);
  await fs.writeFile(path.join(work, 'package.json'), '{"version":"3.8.0"}');
  await fs.unlink(path.join(q, UI_PUBLIC_ARCHIVE));
  await assert.rejects(prepareReleaseAssets({ root: work }), /ENOENT/);
  console.log('PASS: single public version; 8 UIQUE text fields and parent font decoration; missing/invisible fonts rejected; test/production labels; unchanged PNGs/other ZIP payloads; idempotent generation and read-only checks');
} finally {
  assert.equal(path.dirname(work), taskRoot);
  assert(!(await fs.lstat(work)).isSymbolicLink());
  await fs.rm(work, { recursive: true, force: true });
}
