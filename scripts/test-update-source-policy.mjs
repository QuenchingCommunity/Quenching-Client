import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyUpdateSourcePolicy, canonicalUpdateJson } from './lib/update-source-policy.mjs';

const policy = { schema: 1, githubMirrors: ['https://fast.example/', 'https://backup.example/prefix/'] };
const hash = 'a'.repeat(64);
const source = tag => `https://github.com/UIZorrot/Quenching-Client/releases/download/${tag}/app.bin`;
const artifact = tag => ({ size: 1024, sha256: hash, sources: [source(tag), 'https://private.example/objects/file?grant=private'] });
for (const owner of ['UIZorrot', 'QuenchingCommunity']) {
  for (const product of ['Client', 'Assets']) {
    const url = `https://github.com/${owner}/Quenching-${product}/releases/download/v3.7.0/app.bin`;
    const input = { schema: 1, product: 'quenching-client', files: [{ artifact: { size: 1024, sha256: hash, sources: [url] } }] };
    const output = applyUpdateSourcePolicy(input, policy);
    assert.deepEqual(output.files[0].artifact.sources, [url, ...policy.githubMirrors.map(base => base + url)]);
    assert.deepEqual(applyUpdateSourcePolicy(output, policy), output);
  }
}
for (const url of [
  'https://github.com/QuenchingCommunity/Quenching-UGC/releases/download/v1/file.bin',
  'https://github.com/someone-else/Quenching-Client/releases/download/v1/file.bin',
]) {
  const input = { schema: 1, product: 'quenching-client', files: [{ artifact: { sources: [url] } }] };
  assert.deepEqual(applyUpdateSourcePolicy(input, policy).files[0].artifact.sources, [url]);
}
for (const [baseVersion, targetVersion] of [['3.5.0', '3.7.0'], ['3.6.1', '3.9.0'], ['4.0.0', '5.0.0']]) {
  const input = { schema: 1, product: 'quenching-client', baseVersion, targetVersion,
    files: [{ path: 'resources/app.asar', oldSha256: hash, newSha256: hash, artifact: artifact(targetVersion), fullArtifact: artifact(targetVersion) }] };
  const rewritten = applyUpdateSourcePolicy(input, policy);
  const sources = rewritten.files[0].artifact.sources;
  assert.deepEqual(sources, [source(targetVersion), ...policy.githubMirrors.map(base => base + source(targetVersion)), 'https://private.example/objects/file?grant=private']);
  assert.equal(rewritten.files[0].fullArtifact.sources.length, 4);
  assert.equal(input.files[0].artifact.sources.length, 2, 'input remains unchanged');
  assert.deepEqual(applyUpdateSourcePolicy(rewritten, policy), rewritten, 'idempotent');
  const nextPolicy = { schema: 1, githubMirrors: ['https://new.example/'] };
  const replaced = applyUpdateSourcePolicy(rewritten, nextPolicy);
  assert.deepEqual(replaced.files[0].artifact.sources, [source(targetVersion), 'https://new.example/' + source(targetVersion), 'https://private.example/objects/file?grant=private']);
  assert.equal(replaced.files[0].newSha256, hash);
  assert.equal(replaced.baseVersion, baseVersion); assert.equal(replaced.targetVersion, targetVersion);
}
const sync = { schema: 2, product: 'quenching-client', targetVersion: '3.7.0', fileSync: { inventory: artifact('v3.7.0'), objects: ['https://objects.example/{sha256}.bin'] } };
const syncCandidate = applyUpdateSourcePolicy(sync, policy);
assert.deepEqual(syncCandidate.fileSync.inventory, sync.fileSync.inventory);
assert.deepEqual(syncCandidate.fileSync.githubMirrors, policy.githubMirrors);
const snapshotUrl = 'https://metadata.example/quenching/client-files/3.7.0.json.gz';
const metadataInput = { ...sync, fileSync: { ...sync.fileSync, inventory: { ...artifact('v3.7.0'), sources: [snapshotUrl] },
  baselines: { '3.6.1': { ...artifact('v3.6.1'), sources: [snapshotUrl.replace('3.7.0', '3.6.1')] } } } };
const metadataPolicy = { ...policy, metadataMirrors: [{ from: 'https://metadata.example/quenching/', to: 'https://backup.example/quenching/' }] };
const withMetadata = applyUpdateSourcePolicy(metadataInput, metadataPolicy);
assert.deepEqual(withMetadata.fileSync.inventory.sources, [snapshotUrl, snapshotUrl.replace('metadata.example', 'backup.example')]);
assert.equal(withMetadata.fileSync.baselines['3.6.1'].sources.length, 2);
assert.deepEqual(withMetadata.fileSync.objects, metadataInput.fileSync.objects);
assert.equal(withMetadata.fileSync.inventory.sha256, hash);
assert.deepEqual(applyUpdateSourcePolicy(withMetadata, metadataPolicy), withMetadata);
const zip = { schema: 3, product: 'quenching-mod', sequence: 500, version: '8.2', patches: [artifact('v8.2')] };
assert.deepEqual(applyUpdateSourcePolicy(zip, policy).patches, zip.patches);
assert.deepEqual(applyUpdateSourcePolicy(zip, policy).githubMirrors, policy.githubMirrors);
assert.throws(() => applyUpdateSourcePolicy(zip, { schema: 1, githubMirrors: ['http://unsafe/'] }), /mirror/);
assert.throws(() => applyUpdateSourcePolicy({ schema: 1, product: 'quenching-client', files: [{ artifact: artifact('v1') }] },
  { schema: 1, githubMirrors: Array.from({ length: 8 }, (_, i) => `https://mirror${i}.example/`) }), /exceeds 8/);

// End-to-end real private wrapper: input verification, re-signing and no overwrite.
const wrapper = path.resolve('_irys/rewrite-update-sources.mjs');
if (await fs.stat(wrapper).catch(() => null)) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'quenching-source-policy-'));
  try {
    const keys = crypto.generateKeyPairSync('ed25519');
    const signed = { ...sync, signature: { algorithm: 'ed25519', value: crypto.sign(null, Buffer.from(canonicalUpdateJson(sync)), keys.privateKey).toString('base64') } };
    for (const [name, value] of [['input.json', JSON.stringify(signed)], ['policy.json', JSON.stringify(policy)],
      ['public.pem', keys.publicKey.export({ format: 'pem', type: 'spki' })], ['private.pem', keys.privateKey.export({ format: 'pem', type: 'pkcs8' })]]) {
      await fs.writeFile(path.join(root, name), value);
    }
    const args = [wrapper, '--input', path.join(root, 'input.json'), '--output', path.join(root, 'out.json'),
      '--policy', path.join(root, 'policy.json'), '--public-key', path.join(root, 'public.pem'), '--private-key', path.join(root, 'private.pem')];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 8192, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(await fs.readFile(path.join(root, 'out.json'), 'utf8'));
    const signature = output.signature; delete output.signature;
    assert.ok(crypto.verify(null, Buffer.from(canonicalUpdateJson(output)), keys.publicKey, Buffer.from(signature.value, 'base64')));
    assert.deepEqual(output, syncCandidate);
    assert.equal(spawnSync(process.execPath, args, { maxBuffer: 8192, windowsHide: true }).status, 1, 'never overwrite candidate');
    signed.targetVersion = '99.0.0'; await fs.writeFile(path.join(root, 'input.json'), JSON.stringify(signed));
    assert.equal(spawnSync(process.execPath, args, { maxBuffer: 8192, windowsHide: true }).status, 1, 'tampered input rejected');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
console.log('PASS source policy: schema 1/2/3; arbitrary versions; hashes/targets preserved; explicit old-client mirrors; private URLs unchanged; signatures/idempotence/no overwrite');
