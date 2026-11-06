import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import archiver from 'archiver';
import { FileSnapshot } from '../src/shared/file-sync';
import { encodeSnapshot, snapshotDigest } from '../src/Main/services/file-sync-snapshot';
import { planModZipChain, validateModZipPolicy } from '../src/shared/mod-zip-update';
import { applyModUpdate, getModUpdateStatus, getInstalledModState } from '../src/Main/services/mod-update-service';
import { loadIntegrityManifest } from '../src/Main/services/mod-integrity-service';

const hash = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const canonical = (value: any): string => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const keys = crypto.generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
function sign(value: any) {
  const unsigned = { ...value }; delete unsigned.signature;
  return { ...unsigned, signature: { algorithm: 'ed25519', value: crypto.sign(null, Buffer.from(canonical(unsigned)), keys.privateKey).toString('base64') } };
}
function snapshot(version: string, sequence: number, contents: Record<string, string>): FileSnapshot {
  const files = Object.entries(contents).map(([path, text]) => ({ path, size: Buffer.byteLength(text), sha256: hash(text) }));
  return { schema: 1, product: 'quenching-mod', version, sequence, generatedAt: new Date().toISOString(), filesDigest: snapshotDigest(files), files };
}
async function writeTree(root: string, contents: Record<string, string>) {
  for (const [relative, text] of Object.entries(contents)) await fs.outputFile(path.join(root, ...relative.split('/')), text);
}
async function zip(root: string, destination: string) {
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(destination);
    const archive = archiver('zip'); output.on('close', resolve); output.on('error', reject); archive.on('error', reject);
    archive.pipe(output); archive.directory(root, false); void archive.finalize().catch(reject);
  });
}

export async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'quenching-mod-zip-'));
  const publish = path.join(root, 'http'); await fs.ensureDir(publish);
  const requests: string[] = [];
  const server = http.createServer(async (request, response) => {
    try {
      const relative = new URL(request.url || '/', 'http://localhost').pathname.slice(1); requests.push(relative);
      const absolute = path.resolve(publish, relative);
      assert.ok(absolute.startsWith(publish + path.sep));
      const stat = await fs.stat(absolute); response.writeHead(200, { 'Content-Length': stat.size }); fs.createReadStream(absolute).pipe(response);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const oldBaseline = process.env.QUENCHING_BASELINE_MANIFEST;
  delete process.env.QUENCHING_BASELINE_MANIFEST;
  try {
    const original = { 'textures/changed.txt': '35', 'textures/retired.txt': 'old official',
      'textures/player-retired.txt': 'old managed', 'textures/stable.txt': 'not inspected', 'textures/A.txt': 'uppercase' };
    const intermediate = { 'textures/changed.txt': '36', 'textures/stable.txt': 'not inspected',
      'textures/A.txt': 'uppercase', 'textures/new.txt': '36 new' };
    const latest = { ...intermediate, 'textures/changed.txt': '37', 'textures/new.txt': '37 new' };
    const first = snapshot('3.5', 35, original), middle = snapshot('3.6', 36, intermediate), last = snapshot('3.7', 80, latest);
    await fs.outputFile(path.join(root, '35.gz'), encodeSnapshot(first));
    await fs.outputFile(path.join(root, '36.gz'), encodeSnapshot(middle));
    await fs.outputFile(path.join(root, '37.gz'), encodeSnapshot(last));
    await writeTree(path.join(root, 'tree36'), intermediate); await writeTree(path.join(root, 'tree37'), latest);
    const keyPath = path.join(root, 'test-key.pem');
    await fs.writeFile(keyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const publisher = promisify(execFile);
    for (const [from, to] of [['35', '36'], ['36', '37']]) {
      const args = ['--import', 'tsx', '_irys/build-mod-zip.ts', '--fixture', '--from', path.join(root, `${from}.gz`), '--to', path.join(root, `${to}.gz`),
        '--root', path.join(root, `tree${to}`), '--output', path.join(publish, to), '--private-key', keyPath,
        '--url-base', origin + '/missing/', '--url-base', `${origin}/${to}/`];
      if (from === '36') args.push('--chain', path.join(publish, '36', 'mod-zip-manifest.json'));
      await publisher(process.execPath, args, { cwd: process.cwd(), windowsHide: true, maxBuffer: 64 * 1024 });
    }
    const manifest = await fs.readJson(path.join(publish, '37', 'mod-zip-manifest.json'));
    const manifestPath = path.join(publish, 'latest.json'); await fs.writeJson(manifestPath, manifest);
    const options = { manifestUrls: [origin + '/latest.json'], publicKeyPem: publicKey, stagingRoot: path.join(root, 'staging') };
    const policy = validateModZipPolicy(manifest);
    assert.equal(planModZipChain({ version: '3.5', sequence: 35 }, { version: '3.7', sequence: 80 }, policy).patches.length, 2);
    assert.ok(planModZipChain({ version: '3.5', sequence: 35 }, { version: '3.7', sequence: 80 }, { ...policy, maxPatchSteps: 1 }).reason);
    assert.ok(planModZipChain({ version: '3.5', sequence: 35 }, { version: '3.7', sequence: 80 }, { ...policy, patches: policy.patches.slice(1) }).reason);
    assert.throws(() => validateModZipPolicy({ ...manifest, patches: [...manifest.patches, manifest.patches[0]] }), /ambiguous/);

    async function installation(label: string, channel = 'retail') {
      (globalThis as any).__updateFixtureChannel = channel;
      const game = path.join(root, label, '魔兽 中文目录');
      const branch = path.join(game, channel === 'retail' ? '_retail_' : '_ptr_');
      // No local/bundled ownership list; an unchanged official file is missing on purpose.
      await writeTree(branch, { 'QMoff/textures/changed.txt': 'player customized 35', 'QMoff/textures/retired.txt': 'old official',
        'NELonstar/nested/player.txt': 'unmanaged player directory',
        'textures/player-retired.txt': 'player owns this edit', 'textures/custom.txt': 'player file', '_patch/keep.que': '-v3.5-\n' });
      return { game, branch };
    }
    const firstInstall = await installation('success');
    requests.length = 0;
    const status = await getModUpdateStatus(firstInstall.game, options);
    assert.equal(status.patchChain?.length, 2); assert.equal(status.current?.version, '3.5');
    assert.deepEqual(requests, ['latest.json']); // Automatic check is marker + index only.
    const progress: number[] = [];
    const success = await applyModUpdate(firstInstall.game, { ...options, onProgress: event => progress.push(event.percent) });
    assert.ok(success.applied, success.error); assert.equal(success.appliedPatches, 2);
    assert.equal((await getInstalledModState(firstInstall.game))?.version, '3.7');
    const stored = await fs.readJson(path.join(firstInstall.branch, '.quenching/installed-mod.json'));
    assert.equal(stored.files.length, last.files.length, 'committed official ownership list is the full target inventory');
    assert.equal(await fs.readFile(path.join(firstInstall.branch, 'QMoff/textures/changed.txt'), 'utf8'), '37');
    assert.equal(await fs.pathExists(path.join(firstInstall.branch, 'textures/changed.txt')), false);
    assert.equal(await fs.pathExists(path.join(firstInstall.branch, 'QMoff/textures/retired.txt')), false);
    assert.equal(await fs.readFile(path.join(firstInstall.branch, 'textures/player-retired.txt'), 'utf8'), 'player owns this edit');
    assert.equal(await fs.readFile(path.join(firstInstall.branch, 'textures/custom.txt'), 'utf8'), 'player file');
    assert.equal(await fs.pathExists(path.join(firstInstall.branch, 'textures/stable.txt')), false);
    assert.ok(await loadIntegrityManifest(firstInstall.game, '3.7'), 'new ordinal inventory loads with non-Chinese paths');
    assert.ok(progress.every((percent, index) => index === 0 || percent >= progress[index - 1])); assert.equal(progress.at(-1), 100);
    assert.ok(requests.includes('missing/QMF3.5-to-3.6.zip')); // Existing fallback download behavior.
    assert.equal((await getModUpdateStatus(firstInstall.game, options)).decision, 'upToDate');
    assert.equal(await fs.readFile(path.join(firstInstall.branch, 'NELonstar/nested/player.txt'), 'utf8'), 'unmanaged player directory');

    const failureInstall = await installation('rollback');
    const copy = fs.copy;
    let failed = false;
    (fs as any).copy = async (source: string, destination: string, ...args: any[]) => {
      if (!failed && source.includes('step-1') && source.endsWith(path.join('payload', 'textures', 'new.txt')) && destination.startsWith(failureInstall.branch)) {
        failed = true; throw new Error('injected second ZIP installation failure');
      }
      return (copy as any)(source, destination, ...args);
    };
    let failure;
    try { failure = await applyModUpdate(failureInstall.game, options); } finally { fs.copy = copy; }
    assert.equal(failure.applied, false); assert.equal(failure.appliedPatches, 1); assert.match(failure.error || '', /injected/);
    assert.equal((await getInstalledModState(failureInstall.game))?.version, '3.6');
    assert.equal(await fs.readFile(path.join(failureInstall.branch, 'QMoff/textures/changed.txt'), 'utf8'), '36');
    assert.equal(await fs.readFile(path.join(failureInstall.branch, 'textures/new.txt'), 'utf8'), '36 new');
    requests.length = 0;
    const resumed = await applyModUpdate(failureInstall.game, options);
    assert.ok(resumed.applied, resumed.error); assert.equal(resumed.appliedPatches, 1);
    assert.ok(!requests.some(url => url.endsWith('QMF3.5-to-3.6.zip')));
    assert.ok(!requests.some(url => url.endsWith('.zip')), 'verified failed-step ZIP is reused without any ZIP download');
    assert.match(resumed.downloadedFrom || '', /verified-cache/);

    const observerInstall = await installation('closed-progress-window');
    const observer = await applyModUpdate(observerInstall.game, { ...options, onProgress: event => {
      if (event.phase === 'complete') throw new Error('fixture renderer closed after commit');
    } });
    assert.ok(observer.applied, observer.error);
    assert.equal((await getInstalledModState(observerInstall.game))?.version, '3.7');

    const stateInstall = await installation('state-rename-failure');
    const previousState = { sequence: 35, version: '3.5', note: 'previous installed state must survive' };
    const stateFile = path.join(stateInstall.branch, '.quenching/installed-mod.json');
    await fs.outputJson(stateFile, previousState);
    const rename = fs.rename;
    (fs as any).rename = async (source: string, destination: string, ...args: any[]) => {
      if (destination === stateFile) throw new Error('injected state replacement failure');
      return (rename as any)(source, destination, ...args);
    };
    let stateFailure;
    try { stateFailure = await applyModUpdate(stateInstall.game, options); } finally { fs.rename = rename; }
    assert.equal(stateFailure.applied, false);
    assert.deepEqual(await fs.readJson(stateFile), previousState);
    assert.equal((await getInstalledModState(stateInstall.game))?.version, '3.5');
    await fs.writeFile(path.join(stateInstall.branch, '_tmp/mod-update-cache', manifest.patches[0].sha256 + '.bin'), 'corrupt retry ZIP');
    requests.length = 0;
    const repairedCache = await applyModUpdate(stateInstall.game, options);
    assert.ok(repairedCache.applied, repairedCache.error);
    assert(requests.some(url => url.endsWith('QMF3.5-to-3.6.zip')), 'corrupt MOD cache is rejected and fetched again');

    // A corrupt ZIP is authenticated before any player writes; also reject a
    // signed-but-internally-inconsistent payload rather than marking it installed.
    const corruptInstall = await installation('corrupt');
    const inconsistent = path.join(root, 'inconsistent');
    await writeTree(path.join(inconsistent, 'payload'), { 'textures/changed.txt': 'WRONG' });
    await fs.outputFile(path.join(inconsistent, 'inventory.json.gz'), encodeSnapshot(middle));
    await fs.writeJson(path.join(inconsistent, 'patch.json'), { schema: 1, product: 'quenching-mod', fromSequence: 35, toSequence: 36,
      fromVersion: '3.5', version: '3.6', files: middle.files.filter(file => file.path === 'textures/changed.txt') });
    const brokenZip = path.join(publish, 'inconsistent.zip'); await zip(inconsistent, brokenZip);
    const broken = { ...manifest, sequence: 36, version: '3.6', displayVersion: '3.6', patches: [{ ...manifest.patches[0],
      size: (await fs.stat(brokenZip)).size, sha256: hash(await fs.readFile(brokenZip)), sources: [origin + '/inconsistent.zip'] }] };
    await fs.writeJson(manifestPath, sign(broken));
    const mismatch = await applyModUpdate(corruptInstall.game, options);
    assert.equal(mismatch.applied, false); assert.match(mismatch.error || '', /ZIP payload/);
    assert.equal((await getInstalledModState(corruptInstall.game))?.version, '3.5');
    await fs.writeJson(manifestPath, sign({ ...broken, patches: [{ ...broken.patches[0], sha256: hash('different zip') }] }));
    const badHash = await applyModUpdate(corruptInstall.game, options);
    assert.equal(badHash.applied, false); assert.match(badHash.error || '', /sha256 mismatch/);
    await fs.writeJson(manifestPath, { ...manifest, maxPatchSteps: 1 });
    await assert.rejects(() => getModUpdateStatus(corruptInstall.game, options), /signature/);
    await fs.writeJson(manifestPath, sign({ ...manifest, maxPatchSteps: 1 }));
    assert.equal((await getModUpdateStatus(corruptInstall.game, options)).decision, 'requiresFullPackage');

    await fs.writeJson(manifestPath, manifest);
    const ptr = await installation('ptr-success', 'ptr');
    await fs.outputFile(path.join(ptr.game, '_retail_', 'textures', 'other-branch.txt'), 'must stay');
    const ptrResult = await applyModUpdate(ptr.game, options); assert.ok(ptrResult.applied, ptrResult.error);
    assert.equal(await fs.readFile(path.join(ptr.game, '_retail_', 'textures', 'other-branch.txt'), 'utf8'), 'must stay');
    assert.equal((await getInstalledModState(ptr.game))?.version, '3.7');
    console.log('PASS: signed ZIP publisher, successive 3.5 → 3.6 → 3.7, light checks, no baseline gate, QMoff/PTR, fallback, preservation, rollback/resume, digest/hash and policy');
  } finally {
    if (oldBaseline === undefined) delete process.env.QUENCHING_BASELINE_MANIFEST; else process.env.QUENCHING_BASELINE_MANIFEST = oldBaseline;
    delete (globalThis as any).__updateFixtureChannel;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.remove(root);
  }
}
