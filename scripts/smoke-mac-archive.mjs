/** Extract the delivered ZIP, verify it and launch the real packaged renderer. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { smokeMacNative, machOArchitectures } from './mac-native.mjs';

const arch = process.argv[2] || process.arch;
assert.equal(process.platform, 'darwin', 'ZIP launch verification requires macOS');
assert.equal(process.arch, arch, 'Use the target architecture Mac runner');
const archive = path.resolve(`__Bin/QMClient-darwin-${arch}.zip`);
const temporaryRoot = path.resolve('_tmp');
await fs.mkdir(temporaryRoot, { recursive: true });
const work = await fs.mkdtemp(path.join(temporaryRoot, `mac-roundtrip-${arch}-`));
const extracted = path.join(work, 'extracted');
const userData = path.join(work, 'user-data');
const configDir = path.join(work, 'config');
await fs.mkdir(extracted);
await fs.mkdir(userData);
await fs.mkdir(configDir);
let child, socket, output = '', closed = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  execFileSync('ditto', ['-x', '-k', archive, extracted], { stdio: 'inherit' });
  const app = path.join(extracted, 'QMClient.app');
  const executable = path.join(app, 'Contents/MacOS/QMClient');
  assert((await fs.stat(executable)).mode & 0o111, 'ZIP lost executable permissions');
  assert((await fs.lstat(path.join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/Current'))).isSymbolicLink(), 'ZIP lost framework symlinks');
  const file = await fs.open(executable, 'r');
  const header = Buffer.alloc(4096);
  try { await file.read(header, 0, header.length, 0); } finally { await file.close(); }
  assert(machOArchitectures(header).includes(arch), 'Packaged Electron architecture is wrong');
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
  smokeMacNative(executable, path.join(app, 'Contents/Resources/app.asar'));

  const env = { ...process.env, QUENCHING_AUTOMATED_TEST_HEADLESS: '1', QUENCHING_TEST_CONFIG_DIR: configDir };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(executable, [`--user-data-dir=${userData}`, '--remote-debugging-port=0'], {
    cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('exit', () => { closed = true; });
  child.on('error', error => { closed = true; output += String(error); });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output = (output + bytes.toString()).slice(-32768); });
  const deadline = Date.now() + 60000;
  let target;
  while (Date.now() < deadline && !closed) {
    try {
      const port = Number((await fs.readFile(path.join(userData, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      target = (await response.json()).find(page => page.type === 'page' && /renderer\/index\.html/.test(page.url));
      if (target) break;
    } catch { /* App is still creating its renderer. */ }
    await pause(500);
  }
  assert(target, `Packaged app did not create its renderer\n${output.slice(-6000)}`);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (pending.has(message.id)) pending.get(message.id)(message);
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 10000);
    pending.set(id, message => { clearTimeout(timer); pending.delete(id); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
  let state;
  while (Date.now() < deadline && !closed) {
    const result = await call('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async()=>{
      const root=document.getElementById('react-app-root');
      const ready=document.readyState==='complete'&&root?.querySelectorAll('button').length>=4&&typeof window.electronAPI?.getConfig==='function';
      return {ready,title:document.title,url:location.href,buttons:root?.querySelectorAll('button').length||0,
        errorBoundary:document.body?.innerText.includes('应用程序出现错误')||false,
        gameChannel:ready?await window.electronAPI.getConfig('gameChannel'):null};})()` });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    state = result.result.value;
    if (state.ready && !state.errorBoundary && ['retail', 'ptr'].includes(state.gameChannel)) break;
    await pause(500);
  }
  assert(state?.ready && !state.errorBoundary && ['retail', 'ptr'].includes(state.gameChannel), `Renderer/preload/IPC startup failed: ${JSON.stringify(state)}\n${output.slice(-6000)}`);
  const screenshot = await call('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(work, 'startup.png'), Buffer.from(screenshot.data, 'base64'));
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  await fs.writeFile(path.join(work, 'startup-report.json'), JSON.stringify({
    platform: process.platform, arch, commit: process.env.GITHUB_SHA || null, archive,
    bytes: (await fs.stat(archive)).size, sha256: hash.digest('hex'),
    adHocSignatureVerified: true, nativeBindingsLoaded: true, extractedZipLaunched: true, renderer: state,
  }, null, 2));
  console.log(`PASS: ${arch} delivered ZIP extracted; permissions/symlinks/signature/native bindings verified; real renderer + preload + IPC started. Evidence: ${work}`);
} finally {
  socket?.close();
  if (child && !closed) {
    child.kill('SIGTERM');
    for (let i = 0; i < 20 && !closed; i++) await pause(100);
    if (!closed) child.kill('SIGKILL');
  }
  await fs.writeFile(path.join(work, 'startup.log'), output);
  assert.equal(path.dirname(work), temporaryRoot);
  // Retain small logs/screenshots, not the duplicate extracted application.
  await fs.rm(extracted, { recursive: true, force: true });
}
