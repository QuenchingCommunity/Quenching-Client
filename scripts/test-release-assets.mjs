import { resourcePath } from '../src/shared/bundled-resource-paths.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';
import { prepareReleaseAssets, renderWebUI, UI_ARCHIVES, UI_VERSION_FILES, updateUiVersionText } from './prepare-release-assets.mjs';
import { resourceInventory } from './prepare-resource-bundle.mjs';
import { UI_PUBLIC_ARCHIVE } from './split-ui-archives.mjs';
import { releaseLabel } from './lib/release-label.mjs';

const taskRoot = path.resolve('_tmp/ui-que-version-20261027');
await fs.mkdir(taskRoot, { recursive: true });
const work = await fs.mkdtemp(path.join(taskRoot, 'release-assets-'));
const q = path.join(work, 'assets/quenching');
const template = await fs.readFile('scripts/templates/quenching-webui.html', 'utf8');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const versionedPaths = UI_VERSION_FILES;
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
  assert.deepEqual(first.ui.map(item => item.changedFiles), [2, 2]);
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

  // Reproduce a fresh clone: only Git-tracked FDFs, no ignored local backups or ZIPs.
  const clean = path.join(work, 'clean-checkout'), cleanQ = path.join(clean, 'assets/quenching');
  await fs.mkdir(cleanQ, { recursive: true });
  await fs.mkdir(path.join(clean, 'scripts/templates'), { recursive: true });
  await fs.writeFile(path.join(clean, 'scripts/templates/quenching-webui.html'), template);
  await fs.writeFile(path.join(clean, 'package.json'), '{"version":"3.8.0"}');
  await fs.writeFile(path.join(clean, 'release-version.json'), '{"displayVersion":"3.8","channel":"test"}');
  await fs.mkdir(path.join(clean, 'assets/unpacked/tx'), { recursive: true });
  for (const name of ['QuenchingOnCN.png', 'QuenchingOnEN.png']) {
    await fs.copyFile(resourcePath(q, 'tx', name), path.join(clean, 'assets/unpacked/tx', name));
  }
  const publicSource = path.join(clean, 'assets/unpacked/packages/zip-ui-pub/ui-que/console');
  await fs.mkdir(publicSource, { recursive: true });
  await fs.writeFile(path.join(publicSource, 'image.bin'), 'shared-ui');
  for (const archive of UI_ARCHIVES) {
    const prefix = `assets/unpacked/packages/${archive.slice(0, -4)}`;
    const tracked = execFileSync('git', ['ls-files', '-z', prefix], { maxBuffer: 1024 * 1024 }).toString().split('\0').filter(Boolean);
    assert(tracked.length > 0);
    for (const file of tracked) {
      assert(!file.includes('/backup/'), 'Fresh Git checkout must not depend on ignored backups');
      const output = path.join(clean, file);
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, execFileSync('git', ['show', `HEAD:${file}`], { maxBuffer: 1024 * 1024 }));
    }
    assert.equal(await fs.stat(path.join(cleanQ, archive)).catch(() => null), null);
  }
  const cleanResult = await prepareReleaseAssets({ root: clean });
  assert.deepEqual(cleanResult.ui.map(item => item.frames), [2, 2]);
  assert.equal((await prepareReleaseAssets({ root: clean, check: true })).label, '3.8 TEST');
  for (const archive of UI_ARCHIVES) for (const file of UI_VERSION_FILES) {
    const body = await fs.readFile(path.join(clean, 'assets/unpacked/packages', archive.slice(0, -4), file), 'utf8');
    assert.equal(updateUiVersionText(body, '3.8 TEST', true).frames, 1);
  }
  // Local backup directories cannot change field counts or enter the generated bundle.
  const backup = path.join(clean, 'assets/unpacked/packages/zip-ui-20/framedef/backup');
  await fs.mkdir(backup, { recursive: true });
  await fs.writeFile(path.join(backup, 'commandbar.fdf'), 'invalid old backup');
  await fs.writeFile(path.join(backup, 'notes.bin'), 'not a shipping resource');
  assert.equal((await prepareReleaseAssets({ root: clean, check: true })).ui[0].frames, 2);
  assert(Object.keys(await resourceInventory(path.join(clean, 'assets/unpacked'))).every(name => !name.includes('/backup/')));
  const requiredFrame = path.join(clean, 'assets/unpacked/packages/zip-ui-20', UI_VERSION_FILES[0]);
  const savedFrame = await fs.readFile(requiredFrame);
  await fs.unlink(requiredFrame);
  await assert.rejects(prepareReleaseAssets({ root: clean }), /expected 2 active UIQUE version fields/);
  await fs.writeFile(requiredFrame, savedFrame);
  await fs.writeFile(path.join(path.dirname(requiredFrame), 'unexpected.fdf'), savedFrame);
  await assert.rejects(prepareReleaseAssets({ root: clean }), /unexpected UIQUE version field/);
  console.log('PASS: fresh Git FDF sources with 2 active fields per variant, no physical ZIPs or backups; required paths/font validation; backup exclusion; historical ZIP compatibility; TEST/production labels; unchanged PNGs; idempotent generation and read-only checks');
} finally {
  assert.equal(path.dirname(work), taskRoot);
  assert(!(await fs.lstat(work)).isSymbolicLink());
  await fs.rm(work, { recursive: true, force: true });
}
