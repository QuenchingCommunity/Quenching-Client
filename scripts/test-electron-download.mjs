import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import JSZip from 'jszip';
import { downloadElectronZip } from './lib/electron-download.mjs';

const task = path.resolve('_tmp/mac-download-20261027');
fs.mkdirSync(task, { recursive: true });
const root = fs.mkdtempSync(path.join(task, 'test-'));
const zip = new JSZip();
zip.file('Electron.app/Contents/MacOS/Electron', Buffer.alloc(1024 * 1024 + 100, 90));
zip.file('Electron.app/Contents/Info.plist', '<plist/>');
const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
const quiet = { log() {}, warn() {} };
let worker;
try {
  for (const [platform, command] of [['darwin', 'curl'], ['linux', 'curl'], ['win32', 'curl.exe']]) {
    let calls = 0;
    const cacheDir = path.join(root, platform);
    const options = { cacheDir, platform, urls: ['https://fixture/first', 'https://fixture/second'], log: quiet,
      run(binary, args, spawnOptions) {
        calls++;
        assert.equal(binary, command);
        assert(args.includes('--fail')); assert(args.includes('--max-time'));
        assert(spawnOptions.timeout > 0);
        assert.equal(spawnOptions.shell, undefined);
        const output = args[args.indexOf('--output') + 1];
        assert(output.endsWith('.part'));
        fs.writeFileSync(output, calls === 1 ? Buffer.alloc(1024 * 1024 + 10, 65) : archive);
        return { status: 0 };
      } };
    const result = await downloadElectronZip('30.5.1', 'arm64', options);
    assert.equal(calls, 2, 'A large HTTP-200 error page must not be reused as Electron');
    assert.deepEqual(fs.readFileSync(result), archive);
    assert.equal(fs.readdirSync(cacheDir).length, 1, 'Temporary downloads are removed');
    await downloadElectronZip('30.5.1', 'arm64', { ...options, run() { throw new Error('cache miss'); } });
    fs.writeFileSync(result, archive.subarray(0, archive.length - 100));
    await assert.rejects(downloadElectronZip('30.5.1', 'arm64', { ...options, run() {
      return { status: 28, error: new Error('fixture timeout') };
    } }), /fixture timeout/);
    assert(!fs.readdirSync(cacheDir).some(name => name.endsWith('.part')));
  }
  await assert.rejects(downloadElectronZip('30.5.1', 'arm64', { cacheDir: path.join(root, 'no-curl'), platform: 'darwin', log: quiet,
    run() { return { status: null, error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }; },
  }), /unavailable: curl/);
  await assert.rejects(downloadElectronZip('../bad', 'arm64'), /Invalid Electron/);

  // Real system curl against an independent local server: clean cache, HTTP
  // failure and mirror fallback, then a second run with no network request.
  const fixtureZip = path.join(root, 'fixture.zip');
  fs.writeFileSync(fixtureZip, archive);
  worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');
    const http=require('node:http'),fs=require('node:fs');
    const server=http.createServer((req,res)=>{if(req.url==='/404'){res.writeHead(404);res.end('missing');}
      else {res.writeHead(200,{'content-type':'application/zip'});fs.createReadStream(workerData).pipe(res);}});
    server.listen(0,'127.0.0.1',()=>parentPort.postMessage(server.address().port));`, { eval: true, workerData: fixtureZip });
  const port = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  let realCalls = 0;
  const options = { cacheDir: path.join(root, 'real-curl'), log: quiet,
    urls: [`http://127.0.0.1:${port}/404`, `http://127.0.0.1:${port}/electron.zip`],
    run(command, args, opts) { realCalls++; return spawnSync(command, args, { ...opts, stdio: 'pipe' }); },
  };
  const result = await downloadElectronZip('30.5.1', 'x64', options);
  assert.equal(realCalls, 2);
  assert.deepEqual(fs.readFileSync(result), archive);
  await downloadElectronZip('30.5.1', 'x64', options);
  assert.equal(realCalls, 2);
  console.log('PASS: Unix curl / Windows curl.exe; empty cache; real HTTP 404/fallback/download; valid cache reuse; large error pages/truncated archives rejected; missing executable/timeouts; partial-file cleanup');
} finally {
  await worker?.terminate();
  assert.equal(path.dirname(root), task);
  assert(!fs.lstatSync(root).isSymbolicLink());
  fs.rmSync(root, { recursive: true, force: true });
}
