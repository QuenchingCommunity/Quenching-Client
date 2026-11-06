import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { readModUninstallVersions, removeVerifiedModFiles } from '../src/Main/services/mod-uninstall-service';
import type { ModIntegrityManifest } from '../src/Main/services/mod-integrity-service';

const hash = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'quenching-uninstall-'));
const assets = path.join(root, 'empty-client-assets');
try {
  await fs.ensureDir(assets);
  await fs.outputFile(path.join(root, 'NELonstar', 'nested', 'player.txt'), 'unmanaged player directory');
  await fs.outputFile(path.join(root, 't20', 'owned.txt'), 'package');
  await fs.outputFile(path.join(root, 't20', 'custom.txt'), 'player edit');
  await fs.outputFile(path.join(root, 'shaders', 'ps', 'bloomextract.bls'), 'client variant');
  await fs.writeJson(path.join(root, 'shaders', '.quenching-shader-profile'), {
    schema: 1, files: { 'ps/bloomextract.bls': hash('client variant') },
  });
  const manifest = {
    files: [
      { path: 't20/owned.txt', size: 7, sha256: hash('package') },
      { path: 't20/custom.txt', size: 7, sha256: hash('package') },
    ],
  } as ModIntegrityManifest;
  const result = await removeVerifiedModFiles(root, manifest, assets);
  assert.equal(result.removed, 3);
  assert.deepEqual(result.preserved, []);
  assert.equal(await fs.pathExists(path.join(root, 't20', 'owned.txt')), false);
  assert.equal(await fs.pathExists(path.join(root, 't20', 'custom.txt')), false);
  assert.equal(await fs.pathExists(path.join(root, 'shaders', 'ps', 'bloomextract.bls')), false);
  assert.equal(await fs.pathExists(path.join(root, 't20')), false, 'remove empty package folders');
  assert.equal(await fs.readFile(path.join(root, 'NELonstar', 'nested', 'player.txt'), 'utf8'), 'unmanaged player directory');

  const copies = ['', 'QMoff', 'QMoff/.branch-disabled-overlaps', 'QMoff/branch-created', 'QMoff/branch-residuals/test'];
  for (const base of copies) {
    await fs.outputFile(path.join(root, base, 'T20', 'Owned.TXT'), 'modified package copy');
    await fs.outputFile(path.join(root, base, 't20', 'player.txt'), 'keep player file');
    await fs.outputFile(path.join(root, base, 'PostProcessingConfig.txt'), 'client override');
    await fs.outputFile(path.join(root, base, 'units', 'unitskin.txt'), 'client skin');
    await fs.outputFile(path.join(root, base, 'shaders', 'ps', 'managed.bls'), 'managed variant');
    await fs.outputJson(path.join(root, base, 'shaders', '.quenching-shader-profile'), {
      schema: 1, files: { 'ps/managed.bls': hash('managed variant'), '../../outside.txt': hash('outside') },
    });
    await fs.outputFile(path.join(root, base, 'patch', 'keep.que'), '-v3.4-\n');
    await fs.outputFile(path.join(root, base, '_patch', 'keep.que'), '-v3.4-\n-v3.5-\n');
    await fs.outputFile(path.join(root, base, '_patch', 'qmf-3.5.files.json.gz'), 'metadata');
  }
  await fs.outputJson(path.join(root, '.quenching', 'installed-mod.json'), { product: 'quenching-mod', version: '3.5' });
  await fs.outputFile(path.join(root, 'outside.txt'), 'outside');
  await fs.outputFile(path.join(root, 'Data', 'data.000'), 'CASC');
  await fs.outputFile(path.join(root, 'x86_64', 'Warcraft III.exe'), 'game');
  await fs.outputFile(path.join(root, 'external', 'owned.txt'), 'outside linked directory');
  await fs.symlink(path.join(root, 'external'), path.join(root, 't16'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual((await readModUninstallVersions(root)).sort(), ['3.4', '3.5']);
  await removeVerifiedModFiles(root, { ...manifest, version: '3.5', files: [
    ...manifest.files, { path: 't16/owned.txt', size: 1, sha256: hash('package') },
  ] }, assets);
  for (const base of copies) {
    for (const file of ['T20/Owned.TXT', 'PostProcessingConfig.txt', 'units/unitskin.txt', 'shaders/ps/managed.bls',
      'shaders/.quenching-shader-profile', 'patch/keep.que', '_patch/keep.que', '_patch/qmf-3.5.files.json.gz']) {
      assert.equal(await fs.pathExists(path.join(root, base, file)), false, `removed ${base}/${file}`);
    }
    assert.equal(await fs.readFile(path.join(root, base, 't20', 'player.txt'), 'utf8'), 'keep player file');
  }
  assert.equal(await fs.pathExists(path.join(root, '.quenching', 'installed-mod.json')), false);
  assert.equal(await fs.readFile(path.join(root, 'external', 'owned.txt'), 'utf8'), 'outside linked directory');
  for (const [file, value] of [['outside.txt', 'outside'], ['Data/data.000', 'CASC'], ['x86_64/Warcraft III.exe', 'game']]) {
    assert.equal(await fs.readFile(path.join(root, file), 'utf8'), value);
  }
  assert.deepEqual(await readModUninstallVersions(root), []);
  assert.equal((await removeVerifiedModFiles(root, manifest, assets)).removed, 0, 'deletion is repeatable');
  console.log('Known MOD paths are removed even when modified');
} finally {
  await fs.remove(root);
}
