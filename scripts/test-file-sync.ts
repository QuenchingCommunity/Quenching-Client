import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { FileSnapshot, planFileSync, validateFileSync } from '../src/shared/file-sync';
import { decodeSnapshot, encodeSnapshot, snapshotDigest } from '../src/Main/services/file-sync-snapshot';
import { applyModUpdate, getModUpdateStatus } from '../src/Main/services/mod-update-service';
import { getClientUpdateStatus, stageClientFileSync, validateClientUpdateManifest } from '../src/Main/services/client-update-service';

const hash = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const canonical = (value: any): string => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const keys = crypto.generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const sign = (value: any) => ({ ...value, signature: { algorithm: 'ed25519', value: crypto.sign(null, Buffer.from(canonical(value)), keys.privateKey).toString('base64') } });
function snapshot(product: FileSnapshot['product'], version: string, sequence: number, contents: Record<string, string>): FileSnapshot {
  const files = Object.entries(contents).map(([path, text]) => ({ path, size: Buffer.byteLength(text), sha256: hash(text) }));
  return { schema: 1, product, version, sequence, runtimeVersion: '28.2.0', generatedAt: new Date().toISOString(), filesDigest: snapshotDigest(files), files };
}
async function writeTree(root: string, contents: Record<string, string>) {
  for (const [relative, contentsText] of Object.entries(contents)) await fs.outputFile(path.join(root, ...relative.split('/')), contentsText);
}
async function serve(root: string) {
  const requests: string[] = [];
  const server = http.createServer(async (req, res) => {
    const relative = new URL(req.url || '/', 'http://localhost').pathname.slice(1); requests.push(relative);
    try {
      const file = path.resolve(root, relative);
      assert.ok(file.startsWith(path.resolve(root) + path.sep));
      const stat = await fs.stat(file);
      res.writeHead(200, { 'Content-Length': stat.size }); fs.createReadStream(file).pipe(res);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { requests, origin: `http://127.0.0.1:${(server.address() as any).port}`, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

export async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'quenching-file-sync-'));
  const publish = path.join(root, 'http'); await fs.ensureDir(publish);
  const server = await serve(publish);
  const oldTest = process.env.QUENCHING_CLIENT_UPDATE_TEST;
  const oldBaseline = process.env.QUENCHING_BASELINE_MANIFEST;
  const oldResources = (process as any).resourcesPath;
  const oldClientUrl = process.env.QUENCHING_CLIENT_MANIFEST_URL;
  const oldElectronVersion = Object.getOwnPropertyDescriptor(process.versions, 'electron');
  process.env.QUENCHING_CLIENT_UPDATE_TEST = '1';
  (process as any).resourcesPath = path.join(root, 'empty-resources');
  const artifact = async (name: string, bytes: Buffer) => {
    await fs.outputFile(path.join(publish, name), bytes);
    return { size: bytes.length, sha256: hash(bytes), sources: [`${server.origin}/${name}`] };
  };
  const objects = async (contents: Record<string, string>) => {
    for (const text of Object.values(contents)) await fs.outputFile(path.join(publish, 'objects', hash(text) + '.bin'), text);
  };
  try {
    const original = { 'textures/stable.txt': 'stable', 'textures/reverted.txt': 'original', 'textures/changed.txt': 'old',
      'textures/retired.txt': 'owned old file', 'textures/modified-retired.txt': 'official old file', 'textures/retained.txt': 'not implicitly deleted' };
    const intermediate = { ...original, 'textures/reverted.txt': 'intermediate' };
    const target = { 'textures/stable.txt': 'stable', 'textures/reverted.txt': 'original', 'textures/changed.txt': 'latest', 'textures/new.txt': 'new' };
    const first = snapshot('quenching-mod', '3.5', 35, original);
    const middle = snapshot('quenching-mod', '3.7', 37, intermediate);
    const latest = snapshot('quenching-mod', '3.8', 80, target);
    assert.equal(planFileSync(first.files, latest.files).changed.length, 2);
    assert.equal(planFileSync(middle.files, latest.files).changed.length, 3);
    assert.throws(() => validateFileSync({ inventory: { size: 2, sha256: hash('ab'), sources: [{ parts: [{ size: 3, sha256: hash('abc'), url: server.origin + '/part' }] }] }, objects: [server.origin + '/{sha256}'] }));
    await objects(target);
    const fileSync: any = { inventory: await artifact('mod-latest.gz', encodeSnapshot(latest)),
      objects: [`${server.origin}/missing/{sha256}.bin`, `${server.origin}/objects/{sha256}.bin`],
      baselines: { '3.5': await artifact('mod-35.gz', encodeSnapshot(first)), '3.7': await artifact('mod-37.gz', encodeSnapshot(middle)) },
      deleted: [{ path: 'textures/retired.txt', acceptedSha256: [hash(original['textures/retired.txt'])] },
        { path: 'textures/modified-retired.txt', acceptedSha256: [hash(original['textures/modified-retired.txt'])] }] };
    const modParts = [Buffer.from('n'), Buffer.from('ew')];
    const modPartRecords = [];
    for (const [index, bytes] of modParts.entries()) { await artifact(`mod-part${index}`, bytes); modPartRecords.push({ url: `${server.origin}/mod-part${index}`, size: bytes.length, sha256: hash(bytes) }); }
    fileSync.artifacts = { [hash('new')]: { size: 3, sha256: hash('new'), sources: [{ parts: modPartRecords }, `${server.origin}/objects/${hash('new')}.bin`] } };
    const manifest = sign({ schema: 2, product: 'quenching-mod', sequence: 80, version: '3.8', displayVersion: '3.8', fileSync });
    const mirrorTamper = { ...manifest, fileSync: { ...fileSync, githubMirrors: ['https://untrusted-change.example/'] } };
    await fs.outputJson(path.join(publish, 'mirror-tampered.json'), mirrorTamper);
    await assert.rejects(() => getModUpdateStatus(path.join(root, 'unused'), { manifestUrls: [server.origin + '/mirror-tampered.json'], publicKeyPem: publicKey }), /signature/);
    await fs.outputJson(path.join(publish, 'mod.json'), manifest);
    const options = { manifestUrls: [server.origin + '/mod.json'], publicKeyPem: publicKey, stagingRoot: path.join(root, 'staging') };
    const modInstall = async (name: string, prior: FileSnapshot, contents: Record<string, string>, backup = true) => {
      const game = path.join(root, name); const branch = path.join(game, '_retail_');
      await writeTree(branch, contents);
      await fs.outputFile(path.join(branch, '_patch/keep.que'), `-v${prior.version}-\n-s${prior.sequence}-\n`);
      const fixture = path.join(root, `${name}-baseline.gz`); await fs.writeFile(fixture, encodeSnapshot(prior));
      if (backup) await fs.outputFile(path.join(branch, `_patch/qmf-${prior.version}.files.json.gz`), encodeSnapshot(prior));
      process.env.QUENCHING_BASELINE_MANIFEST = fixture;
      return { game, branch };
    };
    for (const [name, prior, contents] of [['mod35', first, original], ['mod37', middle, intermediate]] as const) {
      const { game, branch } = await modInstall(name, prior, contents);
      await fs.outputFile(path.join(branch, 'textures/player-custom.txt'), 'player custom');
      await fs.outputFile(path.join(branch, 'textures/modified-retired.txt'), 'player modification');
      // A configured resource need not occupy its canonical official path.
      await fs.move(path.join(branch, 'textures/stable.txt'), path.join(branch, 'QMoff/textures/stable.txt'));
      server.requests.length = 0;
      const status = await getModUpdateStatus(game, options);
      assert.equal(status.decision, 'patch'); assert.ok(status.fileSync); assert.equal(status.patch, undefined);
      assert.deepEqual(server.requests, ['mod.json'], 'automatic check must not load inventories or resource objects');
      const progress: number[] = [];
      const result = await applyModUpdate(game, { ...options, onProgress: value => progress.push(value.percent) });
      assert.equal(result.applied, true, result.error);
      for (const [relative, text] of Object.entries(target).filter(([relative]) => !relative.includes('stable'))) assert.equal(await fs.readFile(path.join(branch, relative), 'utf8'), text);
      assert.ok(!await fs.pathExists(path.join(branch, 'textures/stable.txt')));
      assert.equal(await fs.readFile(path.join(branch, 'QMoff/textures/stable.txt'), 'utf8'), 'stable');
      assert.equal(await fs.readFile(path.join(branch, 'textures/player-custom.txt'), 'utf8'), 'player custom');
      assert.equal(await fs.readFile(path.join(branch, 'textures/modified-retired.txt'), 'utf8'), 'player modification');
      assert.equal(await fs.readFile(path.join(branch, 'textures/retained.txt'), 'utf8'), 'not implicitly deleted');
      assert.ok(!await fs.pathExists(path.join(branch, 'textures/retired.txt')));
      assert.equal(server.requests.filter(url => url.startsWith('objects/') || url === 'mod-part0').length, name === 'mod35' ? 2 : 3);
      assert.ok(progress.every((percent, index) => index === 0 || percent >= progress[index - 1]), 'progress must not move backwards');
      assert.equal((await getModUpdateStatus(game, options)).decision, 'upToDate');
      assert.equal(decodeSnapshot(await fs.readFile(path.join(branch, '_patch/qmf-3.8.files.json.gz')), 'quenching-mod', '3.8').filesDigest, latest.filesDigest);
    }
    // Downloaded official baseline: no bundled version, no folder scanning.
    const remoteBaseline = await modInstall('remote-baseline', middle, intermediate, false);
    process.env.QUENCHING_BASELINE_MANIFEST = path.join(root, 'absent.gz');
    assert.equal((await applyModUpdate(remoteBaseline.game, options)).applied, true);
    assert.ok(server.requests.includes('mod-37.gz'));
    // Metadata-only release: advance the marker without downloading any resources.
    const metadataOnly = snapshot('quenching-mod', '3.9', 81, target);
    const metadataManifest = sign({ schema: 2, product: 'quenching-mod', sequence: 81, version: '3.9', fileSync: {
      ...fileSync, inventory: await artifact('mod-39.gz', encodeSnapshot(metadataOnly)) } });
    await fs.outputJson(path.join(publish, 'mod.json'), metadataManifest);
    server.requests.length = 0;
    assert.equal((await applyModUpdate(remoteBaseline.game, options)).applied, true);
    assert.equal(server.requests.filter(relative => relative !== 'mod.json' && relative !== 'mod-39.gz').length, 0);
    assert.equal((await getModUpdateStatus(remoteBaseline.game, options)).current?.version, '3.9');
    await fs.outputJson(path.join(publish, 'mod.json'), manifest);

    const bad = await modInstall('corrupt', first, original);
    await fs.outputFile(path.join(publish, 'objects', hash('latest') + '.bin'), 'wrong!');
    assert.equal((await applyModUpdate(bad.game, options)).applied, false);
    assert.equal(await fs.readFile(path.join(bad.branch, 'textures/changed.txt'), 'utf8'), 'old');
    assert.match(await fs.readFile(path.join(bad.branch, '_patch/keep.que'), 'utf8'), /-v3.5-/);
    await objects(target);
    for (const failure of ['backup', 'install']) {
      const temp = await modInstall('rollback-' + failure, first, original);
      const copy = fs.copy; let injected = false;
      (fs as any).copy = async (...args: any[]) => {
        const destination = String(args[1]);
        const hit = failure === 'backup' ? destination.includes('backup-') && destination.endsWith('new.txt') === false && destination.endsWith('keep.que')
          : destination === path.join(temp.branch, 'textures/new.txt');
        if (hit && !injected) { injected = true; throw new Error('injected ' + failure + ' failure'); }
        return (copy as any)(...args);
      };
      try { assert.equal((await applyModUpdate(temp.game, options)).applied, false); } finally { (fs as any).copy = copy; }
      assert.ok(injected);
      assert.equal(await fs.readFile(path.join(temp.branch, 'textures/changed.txt'), 'utf8'), 'old');
      assert.equal(await fs.readFile(path.join(temp.branch, 'textures/retired.txt'), 'utf8'), 'owned old file');
      assert.ok(!await fs.pathExists(path.join(temp.branch, 'textures/new.txt')));
      assert.match(await fs.readFile(path.join(temp.branch, '_patch/keep.que'), 'utf8'), /-v3.5-/);
    }
    await fs.outputJson(path.join(publish, 'mod.json'), { ...manifest, version: '3.9' });
    await assert.rejects(() => getModUpdateStatus(bad.game, options), /signature/);
    await fs.outputJson(path.join(publish, 'mod.json'), manifest);

    const clientOriginal = { 'QMClient.exe': 'same launcher', 'resources/app.asar': 'old app',
      'resources/assets/stable.txt': 'stable', 'resources/assets/reverted.txt': 'original', 'resources/assets/changed.txt': 'old' };
    const clientMiddle = { ...clientOriginal, 'resources/assets/reverted.txt': 'intermediate' };
    const clientTarget = { ...clientOriginal, 'resources/app.asar': 'latest app', 'resources/assets/changed.txt': 'latest asset', 'resources/assets/new/nested.txt': 'new nested' };
    const clientFirst = snapshot('quenching-client', '3.5.0', 35, clientOriginal);
    const clientSecond = snapshot('quenching-client', '3.5.1', 36, clientMiddle);
    const clientLatest = snapshot('quenching-client', '3.8.0', 80, clientTarget);
    await objects(clientTarget);
    const newAsar = Buffer.from(clientTarget['resources/app.asar']);
    const parts = [newAsar.subarray(0, 4), newAsar.subarray(4)];
    const chunkParts = [];
    for (const [index, bytes] of parts.entries()) { await artifact(`client-part${index}`, bytes); chunkParts.push({ url: `${server.origin}/client-part${index}`, size: bytes.length, sha256: hash(bytes) }); }
    const clientSync = { inventory: await artifact('client-latest.gz', encodeSnapshot(clientLatest)), objects: [server.origin + '/objects/{sha256}.bin'],
      baselines: { '3.5.0': await artifact('client-35.gz', encodeSnapshot(clientFirst)), '3.5.1': await artifact('client-351.gz', encodeSnapshot(clientSecond)) },
      artifacts: { [hash(newAsar)]: { size: newAsar.length, sha256: hash(newAsar), sources: [{ parts: chunkParts }, server.origin + '/objects/' + hash(newAsar) + '.bin'] } },
      deltas: [{ path: 'resources/app.asar', oldSha256: hash('old app'), artifact: await artifact('bad-optional.zst', Buffer.from('not zstd')) }] };
    const clientManifest = validateClientUpdateManifest(sign({ schema: 2, product: 'quenching-client', platform: 'win32-x64', runtimeVersion: '28.2.0', targetVersion: '3.8.0', fileSync: clientSync }), publicKey);
    // Status uses only the small signed index. No resource snapshot/objects before confirmation.
    await fs.outputFile(path.join((process as any).resourcesPath, 'assets/quenching/update-public-key.pem'), publicKey);
    const rawClient = sign({ schema: 2, product: 'quenching-client', platform: 'win32-x64', runtimeVersion: '28.2.0', targetVersion: '3.8.0', fileSync: clientSync });
    await fs.outputJson(path.join(publish, 'client.json'), rawClient);
    process.env.QUENCHING_CLIENT_MANIFEST_URL = server.origin + '/client.json';
    Object.defineProperty(process.versions, 'electron', { value: '28.2.0', configurable: true });
    server.requests.length = 0;
    if (process.platform === 'win32' && process.arch === 'x64') {
      assert.equal((await getClientUpdateStatus()).decision, 'available');
      assert.deepEqual(server.requests, ['client.json']);
      Object.defineProperty(process.versions, 'electron', { value: '27.1.0', configurable: true });
      assert.equal((await getClientUpdateStatus()).decision, 'incompatible');
      Object.defineProperty(process.versions, 'electron', { value: '28.2.0', configurable: true });
    }
    assert.throws(() => validateClientUpdateManifest({ ...clientManifest, targetVersion: '3.9.0' }, publicKey), /signature/);
    for (const [name, prior, contents] of [['client35', clientFirst, clientOriginal], ['client351', clientSecond, clientMiddle]] as const) {
      const install = path.join(root, name); await writeTree(install, contents);
      await fs.outputFile(path.join(install, 'resources/assets/player-custom.txt'), 'custom');
      if (name === 'client351') await fs.outputFile(path.join(install, 'resources/assets/updater/client-files.json.gz'), encodeSnapshot(prior));
      if (name === 'client35') await fs.outputFile(path.join(install, 'QMClient.exe'), 'customer actually distributed a different launcher');
      if (name === 'client35') await fs.remove(path.join(publish, 'client-part1'));
      else await fs.outputFile(path.join(publish, 'client-part1'), parts[1]);
      server.requests.length = 0;
      const stage = path.join(install, '.quenching-client-update', '0123456789abcdef01234567'); await fs.ensureDir(stage);
      const files = await stageClientFileSync(clientManifest, install, stage, prior.version);
      assert.equal(files.some(file => file.path === 'resources/assets/stable.txt'), false);
      assert.ok(files.some(file => file.path === 'QMClient.exe'));
      assert.ok(server.requests.includes('bad-optional.zst'), 'matching but failed delta must fall back');
      assert.ok(server.requests.includes('client-part0') && server.requests.includes('client-part1'));
      assert.equal(server.requests.includes('objects/' + hash(newAsar) + '.bin'), name === 'client35', 'broken chunks must fall back to a whole Release file');
      assert.equal(server.requests.includes('objects/' + hash('same launcher') + '.bin'), name === 'client35');
      assert.equal(server.requests.includes('objects/' + hash('original') + '.bin'), name === 'client351');
      assert.equal(await fs.readFile(path.join(install, 'resources/app.asar'), 'utf8'), 'old app', 'staging must not mutate running install');
      assert.equal(await fs.readFile(path.join(install, 'resources/assets/player-custom.txt'), 'utf8'), 'custom');
      const outputSnapshot = path.join(stage, 'new/resources/assets/updater/client-files.json.gz');
      assert.equal(decodeSnapshot(await fs.readFile(outputSnapshot), 'quenching-client', '3.8.0').filesDigest, clientLatest.filesDigest);
      const helperText = await fs.readFile(path.join(process.cwd(), 'assets/updater/client-update-helper.cjs'), 'utf8');
      const module = { exports: {} as any }; let healthy = true; let restartCount = 0;
      const actualRequire = createRequire(path.join(process.cwd(), 'package.json'));
      const testRequire = (name: string) => name !== 'node:child_process' ? actualRequire(name) : {
        spawn: (_exe: string, _args: string[], options: any) => {
          if (options.env.QUENCHING_CLIENT_UPDATE_ACK && healthy) fs.writeFileSync(options.env.QUENCHING_CLIENT_UPDATE_ACK, options.env.QUENCHING_CLIENT_UPDATE_TOKEN);
          else restartCount++;
          return { unref() {}, pid: 123, exitCode: healthy ? null : 1 };
        }, spawnSync() {},
      };
      new Function('require', 'module', 'process', helperText.slice(0, helperText.indexOf('(process.argv[4]')) + '\nmodule.exports = { run };')
        (testRequire, module, { env: { QUENCHING_CLIENT_UPDATE_TEST: '1' }, kill() { throw new Error('not alive'); } });
      const plan = { root: install, stage, token: 'a'.repeat(32), relaunchArgs: [], files: files.map(({ path, oldSha256, newSha256 }) => ({ path, oldSha256, newSha256 })) };
      const planPath = path.join(stage, 'plan.json'); await fs.writeJson(planPath, plan);
      if (name === 'client35') {
        healthy = false;
        await assert.rejects(() => module.exports.run(planPath, 555), /healthy/);
        assert.equal(await fs.readFile(path.join(install, 'resources/app.asar'), 'utf8'), 'old app');
        assert.ok(!await fs.pathExists(path.join(install, 'resources/assets/new/nested.txt')));
        assert.ok(restartCount > 0);
      } else {
        await module.exports.run(planPath, 555);
        assert.equal(await fs.readFile(path.join(install, 'resources/app.asar'), 'utf8'), 'latest app');
        assert.equal(await fs.readFile(path.join(install, 'resources/assets/new/nested.txt'), 'utf8'), 'new nested');
        assert.equal(await fs.readFile(path.join(install, 'QMClient.exe'), 'utf8'), 'same launcher');
        assert.equal((await fs.readJson(path.join(stage, 'journal.json'))).state, 'complete');
      }
    }
    // Exercise the private publisher twice, including a historical file reverting.
    const publisherAvailable = await fs.pathExists(path.join(process.cwd(), '_irys/build-file-sync.mjs'));
    if (publisherAvailable) {
    const publisherRoot = path.join(root, 'publisher-input'); const store = path.join(root, 'publisher-store');
    // Test a deterministic publisher policy, never the operator's private defaults.
    const sourcePolicy = path.join(root, 'source-policy.json');
    await fs.writeJson(sourcePolicy, { schema: 1, githubMirrors: ['https://gh-proxy.org/'], metadataMirrors: [
      { from: 'https://qm.txzy.net/quenching/', to: 'https://metadata-backup.example/quenching/' },
    ] });
    const signingKey = path.join(root, 'ephemeral.pem'); await fs.writeFile(signingKey, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const seed = path.join(root, 'seed.gz'); await fs.writeFile(seed, encodeSnapshot(first));
    const invoke = async (version: string, sequence: number, candidate: string, extra: string[] = []) => {
      const output = await promisify(execFile)(process.execPath, ['_irys/build-file-sync.mjs', '--product', 'quenching-mod', '--root', publisherRoot,
        '--version', version, '--sequence', String(sequence), '--output', candidate, '--store', store,
        '--url-base', 'https://github.com/example/releases/download/latest', '--seed-snapshot', seed, '--private-key', signingKey, '--source-policy', sourcePolicy, ...extra], { maxBuffer: 5000 });
      assert.ok(output.stdout.length < 5000);
      const value = await fs.readJson(path.join(candidate, 'mod-sync-manifest.json')); const unsigned = { ...value }; delete unsigned.signature;
      assert.ok(crypto.verify(null, Buffer.from(canonical(unsigned)), publicKey, Buffer.from(value.signature.value, 'base64')));
      return value;
    };
    const publisherMiddle = { ...intermediate, 'textures/introduced.txt': 'introduced in middle' };
    delete publisherMiddle['textures/retained.txt'];
    await writeTree(publisherRoot, publisherMiddle);
    const out37 = path.join(root, 'out37'); await invoke('3.7', 37, out37);
    const publisherTarget = { ...target, 'textures/introduced.txt': 'introduced in middle', 'textures/retained.txt': original['textures/retained.txt'] };
    await fs.remove(publisherRoot); await writeTree(publisherRoot, publisherTarget);
    const out38 = path.join(root, 'out38'); const published = await invoke('3.8', 80, out38, ['--chunk-url-base', 'https://gitlawb.example/raw', '--chunk-size', '4', '--github-mirror', 'https://gh-proxy.org/', '--metadata-url-base', 'https://qm.txzy.net/quenching/test-files']);
    assert.deepEqual(validateFileSync(published.fileSync).githubMirrors, ['https://gh-proxy.org/']);
    for (const item of [published.fileSync.inventory, ...Object.values(published.fileSync.baselines)] as any[]) {
      assert.equal(item.sources.length, 2);
      assert.ok(item.sources[0].startsWith('https://qm.txzy.net/quenching/test-files/'));
      assert.equal(item.sources[1], item.sources[0].replace('qm.txzy.net', 'metadata-backup.example'));
    }
    assert.ok(published.fileSync.objects.every((url: string) => !url.startsWith('https://qm.txzy.net/')), 'metadata hosting does not move large resource objects to the website');
    assert.ok(await fs.pathExists(path.join(out38, hash('original') + '.bin')), 'reverted resource must be downloadable for intermediate versions');
    assert.ok(!await fs.pathExists(path.join(out38, hash('stable') + '.bin')), 'unchanged resource must not be uploaded');
    assert.ok(await fs.pathExists(path.join(out38, hash('introduced in middle') + '.bin')), 'file introduced in an intermediate release is needed by the oldest supported version');
    assert.ok(await fs.pathExists(path.join(out38, hash(original['textures/retained.txt']) + '.bin')), 'removed then reintroduced file is needed by the release where it was absent');
    validateFileSync(published.fileSync);
    const chunkSource = published.fileSync.artifacts[hash('original')].sources[0];
    const chunkBytes = await Promise.all(chunkSource.parts.map((part: any) => fs.readFile(path.join(out38, new URL(part.url).pathname.split('/').pop()!))));
    assert.equal(hash(Buffer.concat(chunkBytes)), hash('original'));
    assert.deepEqual(Object.keys(published.fileSync.baselines).sort(), ['3.5', '3.7']);
    await fs.outputFile(path.join(publisherRoot, 'textures/changed.txt'), 'different unpublished version');
    await assert.rejects(() => invoke('3.8', 80, path.join(root, 'immutable-check')), /published version cannot be reused/);
    // Client publication must provide both binaries even when a partner is unchanged.
    const clientSeed = path.join(root, 'client-seed.gz'); await fs.writeFile(clientSeed, encodeSnapshot(clientFirst));
    await writeTree(path.join(root, 'client-original-official'), clientOriginal);
    const clientPublishRoot = path.join(root, 'client-publish-input'); await writeTree(clientPublishRoot, clientTarget);
    const testPrivateFiles = {
      'quenching-update-test.json': '{"schema":1,"enabled":true,"baseUrl":"https://qm.txzy.net/quenching/update-test/fixture/"}',
      '.test-config/settings.json': 'private tester settings', '.test-user-data/Cache/session': 'private tester cache',
      'README-TEST.txt': 'test instructions', 'start-update-test.cmd': 'test launch script',
    };
    await writeTree(clientPublishRoot, testPrivateFiles);
    const clientCandidate = path.join(root, 'client-candidate');
    await promisify(execFile)(process.execPath, ['_irys/build-file-sync.mjs', '--product', 'quenching-client', '--root', clientPublishRoot,
      '--version', '3.8.0', '--runtime-version', '28.2.0', '--output', clientCandidate, '--store', path.join(root, 'client-store'),
      '--url-base', 'https://github.com/example/releases/download/latest', '--seed-root', path.join(root, 'client-original-official'), '--seed-version', '3.5.0', '--private-key', signingKey], { maxBuffer: 5000 });
    const publishedClient = await fs.readJson(path.join(clientCandidate, 'latest.json')); validateClientUpdateManifest(publishedClient, publicKey);
    const publishedInventory = decodeSnapshot(await fs.readFile(path.join(clientCandidate, new URL(publishedClient.fileSync.inventory.sources[0]).pathname.split('/').pop()!)), 'quenching-client', '3.8.0');
    assert.ok(publishedInventory.files.every((file: any) => !(file.path in testPrivateFiles)), 'local channel and tester data must not enter update snapshots');
    for (const value of Object.values(testPrivateFiles)) assert.equal(await fs.pathExists(path.join(clientCandidate, hash(value) + '.bin')), false, 'test data must not become a public object');
    assert.ok(await fs.pathExists(path.join(clientCandidate, hash('same launcher') + '.bin')));
    await fs.outputFile(path.join(clientPublishRoot, 'icudtl.dat'), 'unexpected runtime change');
    await assert.rejects(() => promisify(execFile)(process.execPath, ['_irys/build-file-sync.mjs', '--product', 'quenching-client', '--root', clientPublishRoot,
      '--version', '3.9.0', '--runtime-version', '28.2.0', '--output', path.join(root, 'invalid-runtime'), '--store', path.join(root, 'client-store'),
      '--url-base', 'https://github.com/example/releases/download/latest', '--private-key', signingKey], { maxBuffer: 5000 }), /runtime\/core file changed/);
    const zstd = path.join(process.cwd(), 'assets/updater/zstd.exe');
    if (await fs.pathExists(zstd)) {
      const binaryBase = { ...clientOriginal, 'resources/app.asar': 'official-baseline-data-'.repeat(4096) };
      const binaryLatest = { ...binaryBase, 'resources/app.asar': binaryBase['resources/app.asar'] + 'updated contents' };
      const binaryBaseRoot = path.join(root, 'binary-base'); const binaryLatestRoot = path.join(root, 'binary-latest');
      await writeTree(binaryBaseRoot, binaryBase); await writeTree(binaryLatestRoot, binaryLatest);
      const binaryCandidate = path.join(publish, 'binary-candidate');
      await promisify(execFile)(process.execPath, ['_irys/build-file-sync.mjs', '--product', 'quenching-client', '--root', binaryLatestRoot,
        '--version', '3.8.0', '--runtime-version', '28.2.0', '--output', binaryCandidate, '--store', path.join(root, 'binary-store'),
        '--url-base', 'https://github.com/example/releases/download/latest', '--seed-root', binaryBaseRoot, '--seed-version', '3.5.0',
        '--delta-base', binaryBaseRoot, '--zstd', zstd, '--private-key', signingKey], { maxBuffer: 5000 });
      const binaryManifest = await fs.readJson(path.join(binaryCandidate, 'latest.json'));
      assert.ok(binaryManifest.fileSync.deltas.length > 0, 'a matching binary base should produce an optional compact delta');
      const localize = (record: any) => { record.sources = record.sources.map((url: string) => server.origin + '/binary-candidate/' + url.split('/').pop()); };
      localize(binaryManifest.fileSync.inventory);
      for (const record of Object.values(binaryManifest.fileSync.baselines)) localize(record);
      for (const delta of binaryManifest.fileSync.deltas) localize(delta.artifact);
      binaryManifest.fileSync.objects = [server.origin + '/binary-candidate/{sha256}.bin']; delete binaryManifest.signature;
      const verified = validateClientUpdateManifest(sign(binaryManifest), publicKey);
      const binaryStage = path.join(binaryBaseRoot, '.quenching-client-update', '0123456789abcdef01234567'); await fs.ensureDir(binaryStage);
      server.requests.length = 0; (process as any).resourcesPath = process.cwd();
      await stageClientFileSync(verified, binaryBaseRoot, binaryStage, '3.5.0');
      (process as any).resourcesPath = path.join(root, 'empty-resources');
      assert.ok(server.requests.some(url => url.endsWith('.zst')));
      assert.ok(!server.requests.includes('binary-candidate/' + hash(binaryLatest['resources/app.asar']) + '.bin'), 'matching delta should avoid downloading the full ASAR');
      assert.equal(await fs.readFile(path.join(binaryStage, 'new/resources/app.asar'), 'utf8'), binaryLatest['resources/app.asar']);
    }
    }
    console.log(JSON.stringify({ ok: true, mod: ['35/37 -> 80, only changed files', 'lightweight check', 'configured and custom files retained', 'remote baseline', 'metadata-only release', 'tamper/corruption rejected', 'backup/install rollback'],
      client: ['multiple versions -> latest', 'lightweight signed index and runtime check', 'actual EXE differs: whole-file fallback', 'bad delta/missing zstd: fallback', 'chunked source/whole-file fallback', 'healthy commit and failed-start rollback', 'unchanged EXE + changed ASAR pair'],
      publisher: publisherAvailable ? ['signed cumulative metadata', 'reverted/reintroduced/historically added objects retained', 'unchanged objects not uploaded', 'immutable release version', 'GitLawb chunks generated', 'both client binaries available', 'runtime file change rejected', 'optional real zstd delta when installed'] : 'skipped: private _irys tooling absent' }, null, 2));
  } finally {
    if (oldTest === undefined) delete process.env.QUENCHING_CLIENT_UPDATE_TEST; else process.env.QUENCHING_CLIENT_UPDATE_TEST = oldTest;
    if (oldBaseline === undefined) delete process.env.QUENCHING_BASELINE_MANIFEST; else process.env.QUENCHING_BASELINE_MANIFEST = oldBaseline;
    (process as any).resourcesPath = oldResources;
    if (oldClientUrl === undefined) delete process.env.QUENCHING_CLIENT_MANIFEST_URL; else process.env.QUENCHING_CLIENT_MANIFEST_URL = oldClientUrl;
    if (oldElectronVersion) Object.defineProperty(process.versions, 'electron', oldElectronVersion); else delete (process.versions as any).electron;
    await server.close(); await fs.remove(root);
  }
}
