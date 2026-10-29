import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { requestUpdateMetadata, fetchUpdateMetadata } from '../src/Main/services/update-metadata';
import { fetchReleaseGate } from '../src/Main/services/release-gate-service';
import { updateMetadataUrls } from '../src/Main/services/update-metadata-urls';

const requests: string[] = [];
let gate = { schema: 1, version: 'v3.7', modVersion: '3.7', allowed: 1 };
const server = http.createServer((req, res) => {
  requests.push(req.url!);
  if (req.url === '/no-headers') return;
  if (req.url === '/drip') {
    res.writeHead(200); res.write('x');
    const timer = setInterval(() => res.write('x'), 20);
    res.on('close', () => clearInterval(timer)); return;
  }
  if (req.url === '/redirect') { res.writeHead(302, { Location: '/no-headers' }).end(); return; }
  if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }).end(); return; }
  if (req.url === '/unsafe-redirect') { res.writeHead(302, { Location: 'http://example.com/gate' }).end(); return; }
  if (req.url === '/cut') { res.writeHead(200, { 'Content-Length': 100 }); res.write('short'); setTimeout(() => res.destroy(), 15); return; }
  if (req.url === '/big') { res.writeHead(200); res.end('x'.repeat(200)); return; }
  if (req.url === '/big-header') { res.writeHead(200, { 'Content-Length': 200 }); res.end(); return; }
  if (req.url === '/plain') { res.end('v3.4'); return; }
  if (req.url === '/gate') { res.end(JSON.stringify(gate)); return; }
  if (req.url === '/missing') { res.writeHead(404).end(); return; }
  res.end('ok');
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
const read = (route: string) => requestUpdateMetadata(origin + route, { limit: 100, allowHttpLoopback: true, timeoutMs: 150 });
const oldTest = process.env.QUENCHING_UPDATE_TEST;
const oldProxy = process.env.HTTPS_PROXY;
const originalHttpsGet = https.get;
try {
  delete process.env.QUENCHING_UPDATE_TEST;
  process.env.HTTPS_PROXY = 'http://127.0.0.1:1';
  assert.equal((await read('/ok')).toString(), 'ok', 'direct transport ignores proxy environment');
  for (const route of ['/no-headers', '/drip', '/redirect']) {
    const started = Date.now();
    await assert.rejects(() => read(route), /timed out/);
    assert.ok(Date.now() - started < 2000, route + ' must have a whole-request deadline');
  }
  await assert.rejects(() => read('/cut'), /interrupted|aborted|reset/i);
  for (const route of ['/big', '/big-header']) await assert.rejects(() => read(route), /size limit/);
  await assert.rejects(() => read('/loop'), /too many metadata redirects/);
  await assert.rejects(() => read('/unsafe-redirect'), /unsafe update metadata URL/);
  await assert.rejects(() => requestUpdateMetadata(origin + '/ok', { limit: 100 }), /unsafe/);
  // Simulate a request stuck before socket creation (DNS/TLS); abort must still work.
  (https as any).get = (_url: URL, options: any) => {
    const req = new EventEmitter();
    options.signal.addEventListener('abort', () => req.emit('error', new Error('aborted')), { once: true });
    return req;
  };
  await assert.rejects(() => requestUpdateMetadata('https://dns-fixture.invalid/gate', { limit: 100, timeoutMs: 100 }), /timed out/);
  https.get = originalHttpsGet;

  const order: string[] = [];
  const value = await fetchUpdateMetadata(['primary', 'alias', 'primary'], async url => {
    order.push(url);
    if (order.length < 3) throw new Error(url === 'primary' ? 'ECONNRESET' : 'HTTP 404');
    return 'retried';
  });
  assert.equal(value, 'retried'); assert.deepEqual(order, ['primary', 'alias', 'primary']);
  let invalidAttempts = 0;
  await assert.rejects(() => fetchUpdateMetadata(['bad'], async () => { invalidAttempts++; throw new Error('manifest signature invalid'); }), /signature invalid/);
  assert.equal(invalidAttempts, 1);
  const now = Date.now;
  const time = now();
  try {
    let attempt = 0;
    Date.now = () => time + (attempt ? 46_000 : 0);
    await assert.rejects(() => fetchUpdateMetadata(['first', 'never-requested'], async () => {
      attempt++; throw new Error('ECONNRESET');
    }), /failover deadline exceeded/);
    assert.equal(attempt, 1, 'all-source failure must not retry indefinitely');
  } finally { Date.now = now; }
  assert.equal(await fetchUpdateMetadata(['/no-headers', '/ok'], async route => (await read(route)).toString()), 'ok');

  for (const version of ['3.7', '3.9.12', '4.2']) {
    gate = { schema: 1, version: 'v' + version, modVersion: version, allowed: 1 };
    const result = await fetchReleaseGate({ urls: [origin + '/missing', origin + '/plain', origin + '/gate'], timeoutMs: 150 });
    assert.equal(result.gate.modVersion, version);
    assert.equal(result.source, origin + '/gate');
    assert.ok(updateMetadataUrls([`client-manifests/${version}.json`]).every(url => url.includes(version)));
  }
  requests.length = 0;
  gate.allowed = 0;
  assert.equal((await fetchReleaseGate({ urls: [origin + '/gate', origin + '/ok'] })).gate.allowed, 0);
  assert.deepEqual(requests, ['/gate'], 'closed authoritative gate must not fall through to another source');
  await assert.rejects(() => fetchReleaseGate({ urls: [origin + '/plain'] }), /JSON gate required/);
  console.log('PASS metadata: direct, DNS/header/body deadlines, redirects, interrupted/oversize body, fallback/retry, generic versions, legacy-text rejection and allowed=0');
} finally {
  https.get = originalHttpsGet;
  if (oldProxy === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = oldProxy;
  if (oldTest === undefined) delete process.env.QUENCHING_UPDATE_TEST; else process.env.QUENCHING_UPDATE_TEST = oldTest;
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
