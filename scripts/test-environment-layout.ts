import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'fs-extra';
import { parkHdPublicEnvironment, restoreHdPublicEnvironment } from '../src/Main/services/environment-layout-service';

const work = path.resolve('_tmp/foliage-lock');
await fs.ensureDir(work);
const root = await fs.mkdtemp(path.join(work, 'environment-layout-'));
try {
  for (const name of ['environmentmap', 'foliage', 'sky']) {
    await fs.outputFile(path.join(root, 'environment', name, 'package.dds'), name);
  }
  await fs.outputFile(path.join(root, 'environment', 'sky', 'player-custom.dds'), 'player file');
  assert.equal(await parkHdPublicEnvironment(root), true);
  assert.equal(await fs.pathExists(path.join(root, 'environment', 'sky')), false);
  assert.equal(await fs.readFile(path.join(root, 'QMoff', 'hd-environment', 'sky', 'player-custom.dds'), 'utf8'), 'player file');
  assert.equal(await restoreHdPublicEnvironment(root), true);
  assert.equal(await fs.readFile(path.join(root, 'environment', 'sky', 'player-custom.dds'), 'utf8'), 'player file');
  assert.equal(await restoreHdPublicEnvironment(root), false);

  await fs.outputFile(path.join(root, 'QMoff', 'hd-environment', 'sky', 'conflict.dds'), 'parked');
  await fs.outputFile(path.join(root, 'environment', 'sky', 'conflict.dds'), 'active');
  assert.equal(await parkHdPublicEnvironment(root), true);
  assert.equal(await fs.readFile(path.join(root, 'QMoff', 'hd-environment', 'sky', 'conflict.dds'), 'utf8'), 'parked');
  assert.equal(await fs.readFile(path.join(root, 'QMoff', 'hd-environment', 'environmentmap', 'package.dds'), 'utf8'), 'environmentmap');
  assert.equal(await fs.pathExists(path.join(root, '.quenching', 'player-file-backups')), false);
  assert.equal(await restoreHdPublicEnvironment(root), true);
  assert.equal(await fs.readFile(path.join(root, 'environment', 'sky', 'conflict.dds'), 'utf8'), 'parked');
  console.log('Environment layout preservation checks passed');
} finally {
  await fs.remove(root);
}
