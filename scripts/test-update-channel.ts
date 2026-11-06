import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'fs-extra';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { updateTestEnabled, updateTestUrls } from '../src/Main/services/update-channel';
import { updateMetadataUrls, updateGateUrls } from '../src/Main/services/update-metadata-urls';
import { fetchReleaseGate, previewUpdatesEnabled } from '../src/Main/services/release-gate-service';
import { getClientUpdateStatus, stageClientFileSync, validateClientUpdateManifest } from '../src/Main/services/client-update-service';
import { applyModUpdate, getModUpdateStatus } from '../src/Main/services/mod-update-service';
import { encodeSnapshot, snapshotDigest } from '../src/Main/services/file-sync-snapshot';
import type { FileSnapshot } from '../src/shared/file-sync';

const hash = (bytes: string | Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
const canonical = (value: any): string => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;

export async function run() {
  const envNames = ['QUENCHING_UPDATE_TEST', 'QUENCHING_UPDATE_TEST_BASE', 'QUENCHING_PREVIEW_UPDATES', 'QUENCHING_VERSION_URL',
    'QUENCHING_CLIENT_MANIFEST_URL', 'QUENCHING_MANIFEST_URL', 'QUENCHING_BASELINE_MANIFEST', 'QUENCHING_UPDATE_PUBLIC_KEY'];
  const savedEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  const savedResources = (process as any).resourcesPath;
  const savedElectron = Object.getOwnPropertyDescriptor(process.versions, 'electron');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'quenching-update-channel-'));
  const requests: string[] = [];
  const externalRequests: string[] = [];
  const routes = new Map<string, Buffer>();
  const server = http.createServer((request, response) => {
    const route = request.url || '/'; requests.push(route);
    const bytes = routes.get(route);
    if (!bytes) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Length': bytes.length }); response.end(bytes);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const originalGet = https.get;
  // A regression must fail locally rather than contacting the real website.
  (https as any).get = (...args: any[]) => { externalRequests.push(String(args[0])); throw new Error('External network forbidden in fixture'); };
  const keys = crypto.generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const sign = (value: any) => ({ ...value, signature: { algorithm: 'ed25519', value: crypto.sign(null, Buffer.from(canonical(value)), keys.privateKey).toString('base64') } });
  const artifact = (name: string, bytes: Buffer) => {
    const relative = '/test/' + name; routes.set(relative, bytes);
    return { size: bytes.length, sha256: hash(bytes), sources: [origin + relative] };
  };
  const snapshot = (product: FileSnapshot['product'], version: string, contents: Record<string, string>, sequence?: number): FileSnapshot => {
    const files = Object.entries(contents).map(([path, text]) => ({ path, size: Buffer.byteLength(text), sha256: hash(text) }));
    return { schema: 1, product, version, sequence, runtimeVersion: '33.1.0', generatedAt: new Date().toISOString(), filesDigest: snapshotDigest(files), files };
  };
  const writeTree = async (folder: string, contents: Record<string, string>) => {
    for (const [relative, contentsText] of Object.entries(contents)) await fs.outputFile(path.join(folder, relative), contentsText);
  };
  try {
    process.env.QUENCHING_UPDATE_TEST = '1';
    process.env.QUENCHING_UPDATE_TEST_BASE = 'https://www.tianxiazhengyi.net/quenching/update-test/candidate/';
    assert.deepEqual(updateTestUrls('version.que'), [
      'https://www.tianxiazhengyi.net/quenching/update-test/candidate/version-test.que',
    ], 'website TEST only uses the explicitly selected suite');
    process.env.QUENCHING_UPDATE_TEST_BASE = 'https://private-test.example/quenching/update-test/private/';
    assert.deepEqual(updateTestUrls('version.que'), ['https://private-test.example/quenching/update-test/private/version-test.que'], 'custom TEST hosts never escape to public channels');
    process.env.QUENCHING_UPDATE_TEST_BASE = origin + '/test/';
    process.env.QUENCHING_PREVIEW_UPDATES = '0';
    for (const name of ['QUENCHING_VERSION_URL', 'QUENCHING_CLIENT_MANIFEST_URL', 'QUENCHING_MANIFEST_URL']) process.env[name] = 'https://stale-override.example/not-used';
    process.env.QUENCHING_BASELINE_MANIFEST = path.join(root, 'absent.gz');
    (process as any).resourcesPath = path.join(root, 'resources');
    Object.defineProperty(process.versions, 'electron', { value: '33.1.0', configurable: true });
    await fs.outputFile(path.join(process.resourcesPath, 'assets/quenching/update-public-key.pem'), publicKey);
    process.env.QUENCHING_UPDATE_PUBLIC_KEY = publicKey;
    assert.equal(updateTestEnabled(), true);
    assert.equal(previewUpdatesEnabled(), false, 'TEST selection never bypasses the release gate');
    assert.deepEqual(updateTestUrls('client-manifests/latest.json'), [origin + '/test/client-manifests/latest-test.json']);
    routes.set('/test/version-test.que', Buffer.from(JSON.stringify({ schema: 1, version: 'v3.9', modVersion: '3.9', allowed: 0 })));

    const originalClient = { 'QMClient.exe': 'launcher', 'resources/app.asar': 'old app', 'resources/assets/stable.txt': 'stable' };
    const targetClient = { ...originalClient, 'resources/app.asar': 'test app', 'resources/assets/new.txt': 'test resource' };
    const clientFirst = snapshot('quenching-client', '3.5.0', originalClient);
    const clientLatest = snapshot('quenching-client', '3.9.0', targetClient);
    for (const text of Object.values(targetClient)) artifact('objects/' + hash(text) + '.bin', Buffer.from(text));
    const clientValue = sign({ schema: 2, product: 'quenching-client', platform: 'win32-x64', targetVersion: '3.9.0', runtimeVersion: '33.1.0',
      fileSync: { inventory: artifact('client-latest.gz', encodeSnapshot(clientLatest)), objects: [origin + '/test/objects/{sha256}.bin'],
        baselines: { '3.5.0': artifact('client-old.gz', encodeSnapshot(clientFirst)) }, githubMirrors: [] } });
    routes.set('/test/api/quenching/client-manifests/latest-test.json', Buffer.from(JSON.stringify(clientValue)));
    assert.equal((await getClientUpdateStatus()).decision, 'blocked', 'allowed=0 blocks TEST before reading its index');
    assert.deepEqual(requests, ['/test/version-test.que']);
    routes.set('/test/version-test.que', Buffer.from(JSON.stringify({ schema: 1, version: 'v3.9', modVersion: '3.9', allowed: 1 })));
    requests.length = 0;
    const clientStatus = await getClientUpdateStatus();
    assert.equal(clientStatus.decision, 'available', clientStatus.reason);
    assert.equal(clientStatus.currentVersion, app.getVersion(), 'test flag never fakes the installed binary version');
    assert.equal(clientStatus.targetVersion, '3.9.0', 'test target is provided by remote manifest');
    assert.deepEqual(requests, ['/test/version-test.que', '/test/api/quenching/client-manifests/latest-test.json'], 'check reads no file inventories or objects');
    const clientRoot = path.join(root, 'client'); await writeTree(clientRoot, originalClient);
    await fs.outputFile(path.join(clientRoot, 'resources/assets/player.txt'), 'player file');
    const stage = path.join(clientRoot, '.quenching-client-update', '0123456789abcdef01234567');
    await stageClientFileSync(validateClientUpdateManifest(clientValue, publicKey), clientRoot, stage, '3.5.0');
    assert.equal(await fs.readFile(path.join(stage, 'new/resources/app.asar'), 'utf8'), 'test app');
    assert.equal(await fs.readFile(path.join(clientRoot, 'resources/app.asar'), 'utf8'), 'old app');
    assert.equal(await fs.readFile(path.join(clientRoot, 'resources/assets/player.txt'), 'utf8'), 'player file');
    assert.ok(!requests.includes('/test/objects/' + hash('stable') + '.bin'));

    const oldMod = { 'textures/stable.txt': 'stable mod', 'textures/change.txt': 'old mod' };
    const newMod = { ...oldMod, 'textures/change.txt': 'test mod' };
    const modFirst = snapshot('quenching-mod', '3.6', oldMod, 36);
    const modLatest = snapshot('quenching-mod', '3.9', newMod, 39);
    for (const text of Object.values(newMod)) artifact('objects/' + hash(text) + '.bin', Buffer.from(text));
    const modValue = sign({ schema: 2, product: 'quenching-mod', sequence: 39, version: '3.9',
      fileSync: { inventory: artifact('mod-latest.gz', encodeSnapshot(modLatest)), objects: [origin + '/test/objects/{sha256}.bin'],
        baselines: { '3.6': artifact('mod-old.gz', encodeSnapshot(modFirst)) }, githubMirrors: [] } });
    routes.set('/test/api/quenching/mod-sync-manifest-test.json', Buffer.from(JSON.stringify(modValue)));
    const game = path.join(root, 'game'); const branch = path.join(game, '_retail_'); await writeTree(branch, oldMod);
    await fs.outputFile(path.join(branch, '_patch/keep.que'), '-v3.6-\n-s36-\n');
    await fs.outputFile(path.join(branch, 'textures/player.txt'), 'player mod');
    const options = { publicKeyPem: publicKey, stagingRoot: path.join(root, 'staging') };
    requests.length = 0;
    routes.set('/test/version-test.que', Buffer.from(JSON.stringify({ schema: 1, version: 'v3.9', modVersion: '3.9', allowed: 0 })));
    const blockedTestMod = await getModUpdateStatus(game);
    assert.equal(blockedTestMod.decision, 'unavailable'); assert.match(blockedTestMod.reason, /staged but not public/);
    routes.set('/test/version-test.que', Buffer.from(JSON.stringify({ schema: 1, version: 'v3.9', modVersion: '3.9', allowed: 1 })));
    requests.length = 0;
    const modStatus = await getModUpdateStatus(game);
    assert.equal(modStatus.decision, 'patch'); assert.equal(modStatus.current?.version, '3.6'); assert.equal(modStatus.target?.version, '3.9');
    assert.deepEqual(requests, ['/test/api/quenching/mod-zip-manifest-test.json', '/test/quenching/mod-zip-manifest-test.json', '/test/api/quenching/mod-sync-manifest-test.json', '/test/version-test.que']);
    assert.equal((await applyModUpdate(game, options)).applied, true);
    assert.equal(await fs.readFile(path.join(branch, 'textures/change.txt'), 'utf8'), 'test mod');
    assert.equal(await fs.readFile(path.join(branch, 'textures/player.txt'), 'utf8'), 'player mod');
    assert.ok(!requests.includes('/test/objects/' + hash('stable mod') + '.bin'));
    assert.equal(externalRequests.length, 0);

    // New test indices take priority, but a missing ZIP index above safely
    // preserves the already verified test client's schema 2 MOD channel.
    const zipArtifact = artifact('next-mod.zip', Buffer.from('check must not download this ZIP'));
    routes.set('/test/api/quenching/mod-zip-manifest-test.json', Buffer.from(JSON.stringify(sign({
      schema: 3, product: 'quenching-mod', version: '3.10', sequence: 40, patches: [{ ...zipArtifact,
        fromSequence: 39, toSequence: 40, fromVersion: '3.9', version: '3.10', displayVersion: '3.10' }],
    }))));
    requests.length = 0;
    const zipStatus = await getModUpdateStatus(game, options);
    assert.equal(zipStatus.patchChain?.length, 1);
    assert.equal(zipStatus.target?.version, '3.10');
    assert.deepEqual(requests, ['/test/api/quenching/mod-zip-manifest-test.json']);

    // Both channels authenticate the same signed envelope before using a target.
    routes.set('/test/api/quenching/client-manifests/latest-test.json', Buffer.from(JSON.stringify({ ...clientValue, targetVersion: '9.9.9' })));
    assert.equal((await getClientUpdateStatus()).decision, 'unavailable', 'tampered TEST indices never authorize an update');
    routes.set('/test/api/quenching/client-manifests/latest-test.json', Buffer.from(JSON.stringify(clientValue)));
    process.env.QUENCHING_UPDATE_TEST_BASE = origin + '/unavailable/';
    await assert.rejects(() => fetchReleaseGate(), /all version.que sources failed/);
    assert.equal((await getClientUpdateStatus()).decision, 'unavailable');
    assert.equal((await getModUpdateStatus(game, options)).decision, 'unavailable');
    assert.equal(externalRequests.length, 0, 'test failure must not fall back to production or stale overrides');

    process.env.QUENCHING_UPDATE_TEST_BASE = 'https://www.tianxiazhengyi.net/';
    const testAliases = updateMetadataUrls(['client-manifests/latest.json', 'client-manifests/3.6.1.json', 'mod-zip-manifest.json', 'mod-sync-manifest.json', 'manifest.json']);
    const testGates = updateGateUrls();
    assert(testAliases.every(url => /-test\.json$/.test(url)));
    assert(testGates.every(url => /version-test\.que$/.test(url)));
    delete process.env.QUENCHING_UPDATE_TEST;
    const formalAliases = updateMetadataUrls(['client-manifests/latest.json', 'client-manifests/3.6.1.json', 'mod-zip-manifest.json', 'mod-sync-manifest.json', 'manifest.json']);
    assert.deepEqual(testAliases.map(url => url.replace('-test.json', '.json').replace('www.tianxiazhengyi.net', 'qm.txzy.net')), formalAliases.filter(url => url.startsWith('https://qm.txzy.net/')), 'same aliases and schema fallback order in both channels');
    assert.equal(updateTestUrls('client-manifests/latest.json'), undefined, 'removing only the flag ignores leftover test base');
    assert.equal(previewUpdatesEnabled(), false);
    requests.length = 0;
    await getClientUpdateStatus();
    assert.equal(requests.length, 0, 'disabled flag never fetches test paths');
    assert.ok(externalRequests.length > 0, 'normal metadata routing resumes without rebuilding');
    // The ordinary public gate must still block updates when the isolated flag is off.
    process.env.QUENCHING_VERSION_URL = origin + '/formal/version.que';
    process.env.QUENCHING_MANIFEST_URL = origin + '/formal/mod.json';
    routes.set('/formal/mod.json', Buffer.from(JSON.stringify(modValue)));
    routes.set('/formal/version.que', Buffer.from(JSON.stringify({ schema: 1, version: 'v3.9', modVersion: '3.9', allowed: 0 })));
    assert.equal((await getClientUpdateStatus()).decision, 'blocked', 'formal allowed=0 has the same behavior');
    const blocked = await getModUpdateStatus(game);
    assert.equal(blocked.decision, 'unavailable'); assert.match(blocked.reason, /staged but not public/);
    routes.set('/formal/version.que', Buffer.from(JSON.stringify({ schema: 1, version: 'v3.9', modVersion: '3.9', allowed: 1 })));
    assert.equal((await getModUpdateStatus(game)).decision, 'upToDate');
    routes.set('/formal/version.que', Buffer.from(JSON.stringify({ schema: 1, version: 'v4.0', modVersion: '4.0', allowed: 1 })));
    assert.match((await getModUpdateStatus(game)).reason, /not 3\.9/);
    console.log('PASS: isolated flag; remote test versions/manifests/resources; cross-version client staging and MOD apply; no production fallback; disabling flag restores normal routing');
  } finally {
    https.get = originalGet;
    for (const name of envNames) { if (savedEnv[name] === undefined) delete process.env[name]; else process.env[name] = savedEnv[name]; }
    (process as any).resourcesPath = savedResources;
    if (savedElectron) Object.defineProperty(process.versions, 'electron', savedElectron); else delete (process.versions as any).electron;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.remove(root);
  }
}
