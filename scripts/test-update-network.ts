import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { getUpdateResponse } from '../src/Main/services/update-network';

let matchingRequestAttempted = false;
await assert.rejects(getUpdateResponse('https://qmapi-cn1.txzy.net/quenching/update-test/version.que', {
}, { lookup: async () => { matchingRequestAttempted = true; return []; } }), /Matching server cannot be used for updates/);
assert.equal(matchingRequestAttempted, false, 'update traffic must never resolve or contact the matching server');

const parent = path.resolve('_tmp/update-network');
await fs.mkdir(parent, { recursive: true });
const task = await fs.mkdtemp(path.join(parent, 'tls-'));
const keyFile = path.join(task, 'key.pem'), certFile = path.join(task, 'cert.pem');
execFileSync(process.env.QUENCHING_OPENSSL || 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', keyFile, '-out', certFile], { stdio: 'ignore', windowsHide: true });
const certificate = await fs.readFile(certFile);
let healthyRequests = 0, stalledConnections = 0;
const peers = new Set<net.Socket>();
const good = https.createServer({ key: await fs.readFile(keyFile), cert: certificate }, (req, res) => {
  healthyRequests++;
  assert.equal(req.headers.host, `localhost:${port}`);
  assert.equal((req.socket as import('node:tls').TLSSocket).servername, 'localhost');
  if (req.url === '/unavailable') res.writeHead(503).end('unavailable');
  else res.end('verified transport fixture');
});
await new Promise<void>(resolve => good.listen(0, '127.0.0.1', resolve));
const port = (good.address() as net.AddressInfo).port;
const stalled = net.createServer(socket => { stalledConnections++; peers.add(socket); socket.on('close', () => peers.delete(socket)); });
await new Promise<void>(resolve => stalled.listen(port, '127.0.0.2', resolve));
let lookups = 0;
const dependencies = {
  connectTimeoutMs: 60,
  lookup: async () => { lookups++; return [{ address: '127.0.0.2', family: 4 }, { address: '127.0.0.1', family: 4 }]; },
  httpsGet: ((url: URL, options: any, callback: any) => https.get(url, {
    ...options, ca: certificate,
    lookup: options.lookup || ((_host: string, settings: any, done: any) => settings.all
      ? done(null, [{ address: '127.0.0.2', family: 4 }]) : done(null, '127.0.0.2', 4)),
    autoSelectFamily: false, agent: false,
  }, callback)) as typeof https.get,
};
async function body(response: import('node:http').IncomingMessage) { const chunks: Buffer[] = []; for await (const b of response) chunks.push(b); return Buffer.concat(chunks).toString(); }
try {
  assert.equal(await body(await getUpdateResponse(`https://localhost:${port}/payload`, {}, dependencies)), 'verified transport fixture');
  assert.equal(stalledConnections, 1, 'first address accepts TCP but stalls TLS');
  assert.equal(lookups, 1); assert.equal(healthyRequests, 1);
  assert.equal(await body(await getUpdateResponse(`https://localhost:${port}/payload`, {}, dependencies)), 'verified transport fixture');
  assert.equal(stalledConnections, 1, 'reuse a recently working address');
  const unavailable = await getUpdateResponse(`https://localhost:${port}/unavailable`, {}, dependencies);
  assert.equal(unavailable.statusCode, 503); unavailable.resume();
  assert.equal(stalledConnections, 1, 'an HTTP error does not authorize replay across addresses');
  await assert.rejects(getUpdateResponse(`https://wrong-host.invalid:${port}/payload`, {}, dependencies), /Hostname\/IP does not match|altname/i);
  const controller = new AbortController();
  const before = lookups; const pending = getUpdateResponse(`https://cancel.invalid:${port}/payload`, { signal: controller.signal }, dependencies);
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, /abort/i); assert.equal(lookups, before, 'caller abort does not start DNS fallback');
  console.log('PASS network: TCP-success/TLS-stall retries another DNS address, Host/SNI/certificate preserved, working-address reuse, HTTP errors and cancellation');
} finally {
  for (const socket of peers) socket.destroy();
  good.closeAllConnections();
  await Promise.all([new Promise<void>(resolve => good.close(() => resolve())), new Promise<void>(resolve => stalled.close(() => resolve()))]);
}
