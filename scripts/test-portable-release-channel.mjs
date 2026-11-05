import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PORTABLE_TEST_MARKER, preparePortableChannel, portableTestMarker, isPortableTestOnlyPath, isPortableRuntimePath } from './portable-release-channel.mjs';

const work = await fs.mkdtemp(path.join(os.tmpdir(), 'quenching-export-channel-'));
const root = path.join(work, 'candidate');
const baseUrl = 'https://qm.txzy.net/quenching/update-test/candidate-fixture/';
try {
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'QMClient.exe'), 'fixture; never executed');
  const first = await preparePortableChannel(root, { baseUrl });
  assert.equal(first.channel, 'test', 'the first/default portable is always labelled for testing');
  const bytes = await fs.readFile(path.join(root, PORTABLE_TEST_MARKER));
  assert.deepEqual(JSON.parse(bytes), { schema: 1, enabled: true, baseUrl });
  await preparePortableChannel(root, { baseUrl });
  assert.deepEqual(await fs.readFile(path.join(root, PORTABLE_TEST_MARKER)), bytes);
  await assert.rejects(preparePortableChannel(root, { baseUrl: baseUrl + 'other/' }), /differs/);
  await assert.rejects(preparePortableChannel(root, { channel: 'production' }), /still contains/);
  assert.deepEqual(await fs.readFile(path.join(root, PORTABLE_TEST_MARKER)), bytes, 'formal validation must not remove the user test marker');
  const formal = path.join(work, 'formal'); await fs.mkdir(formal);
  await fs.writeFile(path.join(formal, 'QMClient.exe'), 'fixture; never executed');
  await assert.rejects(preparePortableChannel(formal), /explicit --test-base/);
  await assert.rejects(preparePortableChannel(formal, { channel: 'production', baseUrl }), /cannot specify/);
  assert.equal((await preparePortableChannel(formal, { channel: 'production' })).marker, null);
  assert.equal(await fs.stat(path.join(formal, PORTABLE_TEST_MARKER)).catch(() => null), null);
  for (const url of ['https://qm.txzy.net/', 'https://qm.txzy.net/quenching/client-manifests/', 'http://example.com/quenching/update-test/',
    'https://qm.txzy.net/quenching/update-test/no-slash', 'https://u:p@qm.txzy.net/quenching/update-test/',
    'https://qm.txzy.net/quenching/update-test/?x=1']) assert.throws(() => portableTestMarker(url));
  assert.equal(portableTestMarker('http://127.0.0.1:1234/fixture/').enabled, true);
  for (const name of ['.test-config', '.test-user-data', '.quenching-client-update', 'README-TEST.txt', 'start-update-test.cmd', 'unpacked', '_tmp']) {
    await fs.mkdir(path.join(formal, name));
    for (const channel of ['production', 'test']) await assert.rejects(preparePortableChannel(formal, { channel, ...(channel === 'test' ? { baseUrl } : {}) }), /fresh build/);
    await fs.rmdir(path.join(formal, name));
  }
  for (const name of [PORTABLE_TEST_MARKER, '.test-config/settings.json', '.test-user-data/Cache/file', 'README-TEST.txt', 'start-update-test.cmd']) {
    assert.equal(isPortableTestOnlyPath(name), true);
  }
  for (const name of ['QMClient.exe', 'resources/app.asar', 'resources/assets/quenching/shaders.zip', 'resources/assets/README-TEST.txt']) {
    assert.equal(isPortableTestOnlyPath(name), false);
  }
  console.log('PASS: default marked test export, explicit production, isolated URLs, marker persistence and test state excluded from inventories');
  for (const name of ['unpacked','unpacked/shaders/a.bls','UNPACKED\\.ready.json','_tmp/resource-unpack-123/prepared/a']) assert(isPortableRuntimePath(name));
  for (const name of ['QMClient.exe','resources/app.asar.unpacked/addon.node','resources/assets/quenching/resources-ui.7z']) assert(!isPortableRuntimePath(name));
} finally {
  assert.equal(path.dirname(root), work);
  await fs.rm(work, { recursive: true, force: true });
}
