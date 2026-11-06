import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { downloadUpdateFile, rememberUpdateDownloadSource, SlowUpdateDownloadError, UPDATE_DOWNLOAD_POLICY, updateDownloadSources } from '../src/Main/services/update-download';
import { validateGithubMirrors } from '../src/shared/file-sync';

// Test-only candidate policy. Production addresses must come from signed metadata.
const githubMirrors = validateGithubMirrors(['https://gh-proxy.com/', 'https://gh-proxy.org/', 'https://ghfast.top/']);

const payload = Buffer.alloc(128 * 1024, 7);
const hash = crypto.createHash('sha256').update(payload).digest('hex');
const policy = { graceMs: 0, windowMs: 100, sampleMs: 10, minimumBytesPerSecond: 8 * 1024, minimumRemainingBytes: 1024 };
const requests: string[] = [];
let slowClosed = false;
const server = http.createServer((request, response) => {
  requests.push(request.url || '');
  if (request.url === '/redirect') { response.writeHead(302, { Location: '/fast' }).end(); return; }
  if (request.url === '/loop') { response.writeHead(302, { Location: '/loop' }).end(); return; }
  if (request.url === '/oversize') { response.writeHead(200, { 'Content-Length': payload.length + 1 }).end(); return; }
  if (request.url === '/error') { response.writeHead(503).end(); return; }
  if (request.url === '/truncated') { response.end(payload.subarray(0, 200)); return; }
  if (request.url === '/corrupt') { response.end(Buffer.alloc(payload.length, 9)); return; }
  if (request.url === '/stalled') {
    response.writeHead(200); response.flushHeaders(); return;
  }
  if (request.url === '/headers') return;
  if (request.url === '/slow') {
    response.writeHead(200); response.flushHeaders();
    const timer = setInterval(() => response.write(payload.subarray(0, 32)), 20);
    response.on('close', () => { clearInterval(timer); slowClosed = true; }); return;
  }
  if (request.url === '/last' || request.url === '/small') {
    // Wait longer than the speed observation window but keep the socket active.
    const content = request.url === '/small' ? payload.subarray(0, 100) : payload;
    let sent = 0;
    const timer = setInterval(() => {
      if (sent++ < 12) response.write(content.subarray(0, 1));
      else { clearInterval(timer); response.end(content.subarray(12)); }
    }, 20);
    response.on('close', () => clearInterval(timer)); return;
  }
  response.end(payload);
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'quenching-download-test-'));
const destination = path.join(root, 'artifact');
const options = { expectedHash: hash, slowFallback: true, allowHttpLoopback: true, policy };
async function clean() { await fs.rm(destination, { force: true }); }
try {
  const github = 'https://github.com/UIZorrot/Quenching-Client/releases/download/3.5/test.bin';
  const mirrors = githubMirrors.map(base => base + github);
  const mirror = mirrors[0];
  const gitlawb = 'https://node.gitlawb.com/example';
  const r2 = 'https://qm.txzy.net/private/example?token=secret';
  const parts = { parts: [{ url: gitlawb, size: 1, sha256: 'a'.repeat(64) }] };
  assert.equal(UPDATE_DOWNLOAD_POLICY.graceMs + UPDATE_DOWNLOAD_POLICY.windowMs, 40_000, 'allow cold connections and sustained progress before switching');
  assert.equal(UPDATE_DOWNLOAD_POLICY.minimumBytesPerSecond, 32 * 1024);
  assert.deepEqual(updateDownloadSources([mirror, github, mirror], githubMirrors), [mirror, github, ...mirrors.slice(1)], 'do not retry identical sources under explicit and expanded policies');
  assert.deepEqual(updateDownloadSources([gitlawb, github, parts, r2], githubMirrors), [gitlawb, github, ...mirrors, parts, r2]);
  assert.deepEqual(updateDownloadSources([github]), [github], 'no policy means no hardcoded mirror');
  for (const owner of ['UIZorrot', 'QuenchingCommunity']) {
    for (const product of ['Client', 'Assets']) {
      const url = `https://github.com/${owner}/Quenching-${product}/releases/download/v3.7.0/test.bin`;
      assert.deepEqual(updateDownloadSources([url], githubMirrors), [url, ...githubMirrors.map(base => base + url)]);
    }
  }
  const ugc = 'https://github.com/QuenchingCommunity/Quenching-UGC/releases/download/v1/test.bin';
  assert.deepEqual(updateDownloadSources([ugc], githubMirrors), [ugc], 'UGC is not an official update repository');
  for (const rejected of [r2, github + '?token=secret', github + '#fragment', github.replace('github.com', 'github.com.evil.test'),
    github.replace('https://', 'https://user:secret@'), github.replace('/releases/download/', '/raw/'),
    github.replace('/UIZorrot/', '/someone-else/'), 'http://github.com/UIZorrot/Quenching-Client/releases/download/3.5/test.bin']) {
    assert.deepEqual(updateDownloadSources([rejected], githubMirrors), [rejected]);
  }
  await downloadUpdateFile(origin + '/redirect', destination, payload.length, options);
  assert.deepEqual(await fs.readFile(destination), payload); await clean();
  for (const route of ['/slow', '/stalled', '/headers']) {
    const started = Date.now();
    await assert.rejects(downloadUpdateFile(origin + route, destination, payload.length, options), SlowUpdateDownloadError);
    assert.ok(Date.now() - started < 1500, `${route} must leave a slow source promptly`);
    // The rejected pipeline must have released its Windows file handle before retry.
    await clean();
    await downloadUpdateFile(origin + '/fast', destination, payload.length, options);
    assert.deepEqual(await fs.readFile(destination), payload); await clean();
  }
  assert.equal(slowClosed, true);
  for (const route of ['/corrupt', '/truncated', '/oversize', '/error', '/loop']) {
    await assert.rejects(downloadUpdateFile(origin + route, destination, payload.length, options)); await clean();
    await downloadUpdateFile(origin + '/fast', destination, payload.length, options); await clean();
  }
  await downloadUpdateFile(origin + '/last', destination, payload.length, { ...options, slowFallback: false });
  assert.deepEqual(await fs.readFile(destination), payload); await clean();
  const small = payload.subarray(0, 100);
  await downloadUpdateFile(origin + '/small', destination, small.length, { ...options,
    expectedHash: crypto.createHash('sha256').update(small).digest('hex') }); await clean();
  await assert.rejects(downloadUpdateFile(origin + '/fast', destination, payload.length, { ...options, allowHttpLoopback: false }), /unsafe update URL/);
  rememberUpdateDownloadSource(mirror, githubMirrors);
  assert.deepEqual(updateDownloadSources([github, r2], githubMirrors), [mirror, github, ...mirrors.slice(1), r2]);
  let preferred = mirror;
  if (mirrors.length > 1) {
    preferred = mirrors[1];
    rememberUpdateDownloadSource(preferred, githubMirrors);
    assert.deepEqual(updateDownloadSources([github, r2], githubMirrors), [preferred, github, ...mirrors.filter(source => source !== preferred), r2]);
  }
  assert.ok(mirrors.some(source => source.startsWith('https://gh-proxy.org/')), 'org remains an optional per-file fallback');
  assert.ok(mirrors.some(source => source.startsWith('https://ghfast.top/')), 'additional Release mirror is available');
  for (const removed of ['https://ghproxy.net/']) {
    assert.ok(updateDownloadSources([github], githubMirrors).every(source => typeof source !== 'string' || !source.startsWith(removed)), 'disabled mirror removed');
    rememberUpdateDownloadSource(removed + github, githubMirrors);
    assert.equal(updateDownloadSources([github], githubMirrors)[0], preferred, 'disabled mirrors cannot become preferred');
  }
  rememberUpdateDownloadSource('https://unapproved-proxy.example/' + github, githubMirrors);
  assert.equal(updateDownloadSources([github], githubMirrors)[0], preferred, 'only signed-policy mirrors become preferred');
  assert.deepEqual(updateDownloadSources([github], []), [github], 'remote disable overrides remembered success');
  const reordered = [...githubMirrors].reverse();
  assert.deepEqual(updateDownloadSources([github], reordered), [github, ...reordered.map(base => base + github)], 'new remote priority invalidates old preference');
  const replacement = ['https://replacement.example/download/'];
  assert.deepEqual(updateDownloadSources([github], replacement), [github, replacement[0] + github], 'remote replacement needs no binary change');
  for (const invalid of [['http://example.com/'], ['https://user:password@example.com/'], ['https://example.com/?key=secret'], ['https://example.com']]) {
    assert.throws(() => validateGithubMirrors(invalid));
  }
  assert.ok(requests.filter(route => route === '/loop').length <= 6, 'redirect retries are bounded');
  console.log('PASS: low-speed/stalled/headers failover; fast/small/final transfers; redirect bounds; hash/size rejection; mirror restrictions and preference');
  if (process.argv.includes('--production-window')) {
    const started = Date.now();
    await assert.rejects(downloadUpdateFile(origin + '/slow', destination, payload.length, {
      ...options, policy: UPDATE_DOWNLOAD_POLICY,
    }), SlowUpdateDownloadError);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 14_000 && elapsed < 18_000, `production window took ${elapsed}ms`);
    await clean();
    console.log(`PASS: actual production slow-source cutoff ${elapsed}ms`);
  }
  if (process.argv.includes('--live')) {
    const release = 'https://github.com/UIZorrot/Quenching-Client/releases/download/3.5/client-351-00000-a69aca63a216.zst';
    for (const url of [release, ...githubMirrors.map(base => base + release)]) {
      const started = Date.now();
      await downloadUpdateFile(url, destination, 114212, {
        expectedHash: '736abba411af898fb3b87e01576820b8cf977db2c86610b3b8aa95f64016f998', slowFallback: true,
      });
      console.log(`PASS: live Release transport/hash ${new URL(url).host} ${Date.now() - started}ms`);
      await clean();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await fs.rm(root, { recursive: true, force: true });
}
