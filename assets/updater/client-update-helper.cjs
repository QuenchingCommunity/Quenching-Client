'use strict';
// Runs under ELECTRON_RUN_AS_NODE from QMClient.next.exe after the old UI exits.
// Keep this file outside app.asar: the updater must survive replacing app.asar.
process.noAsar = true;
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = file => {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const block = Buffer.allocUnsafe(1024 * 1024);
  try { for (let n; (n = fs.readSync(fd, block, 0, block.length, null)) > 0;) h.update(block.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
};
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const safeRelative = value => typeof value === 'string' && value.length > 0 && !/[\\:\0]/.test(value) &&
  !value.startsWith('/') && value.split('/').every(segment => segment && segment !== '.' && segment !== '..');
const managedPath = value => value === 'QMClient.exe' || value === 'resources/app.asar' ||
  value.startsWith('resources/assets/') || value.startsWith('resources/statics/') || value.startsWith('resources/app.asar.unpacked/');
function assertNoLinks(root, relative) {
  let cursor = root;
  if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('install root is a link');
  for (const segment of relative.split('/')) {
    cursor = path.join(cursor, segment);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`linked update path: ${relative}`);
  }
}
function isAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function waitUntilGone(pid, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    if (Date.now() > end) throw new Error('old client did not exit');
    await sleep(250);
  }
}
async function writeJournal(file, value) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value));
  // Windows scanners/readers may briefly hold the old journal. Keep the
  // durable before-replace record; never skip it or fall back to a torn write.
  await retry(() => fs.renameSync(temp, file));
}
async function retry(fn, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try { return fn(); }
    catch (error) { if (Date.now() > end) throw error; await sleep(300); }
  }
}
async function restore(root, stage, files) {
  const backup = path.join(stage, 'backup');
  for (const relative of [...files].reverse()) {
    if (!safeRelative(relative) || !managedPath(relative)) throw new Error('unsafe recovery path');
    const target = path.join(root, ...relative.split('/'));
    const saved = path.join(backup, ...relative.split('/'));
    assertNoLinks(root, relative);
    if (!fs.existsSync(saved)) {
      // Only newly introduced files have no backup. Never delete a player
      // file unless the signed plan explicitly marked it as new.
      continue;
    }
    await retry(() => {
      const restoring = target + '.quenching-restoring';
      fs.copyFileSync(saved, restoring);
      fs.renameSync(restoring, target);
    });
    fs.rmSync(target + '.quenching-incoming', { force: true });
  }
}
function restartOriginal(root, relaunchArgs = []) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.QUENCHING_CLIENT_UPDATE_ACK;
  delete env.QUENCHING_CLIENT_UPDATE_TOKEN;
  const child = cp.spawn(path.join(root, 'QMClient.exe'), relaunchArgs, { cwd: root, detached: true, stdio: 'ignore', env });
  child.unref();
}
async function run(planPath, oldPid) {
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const root = path.resolve(plan.root);
  const stage = path.resolve(plan.stage);
  if (path.dirname(stage) !== path.join(root, '.quenching-client-update') ||
      !Array.isArray(plan.files) || plan.files.length === 0 || !Number.isInteger(oldPid) || oldPid <= 0 ||
      typeof plan.token !== 'string' || !/^[a-f0-9]{32}$/.test(plan.token)) throw new Error('invalid update plan');
  if (!Array.isArray(plan.relaunchArgs) || !plan.relaunchArgs.every(arg => typeof arg === 'string' &&
      (arg.startsWith('--user-data-dir=') || (process.env.QUENCHING_CLIENT_UPDATE_TEST === '1' && arg.startsWith('--remote-debugging-port='))))) throw new Error('invalid relaunch arguments');
  const names = new Set();
  for (const file of plan.files) {
    if (!safeRelative(file.path) || !managedPath(file.path) || names.has(file.path.toLowerCase()) ||
        (file.oldSha256 !== null && !validHash(file.oldSha256)) || !validHash(file.newSha256)) throw new Error('invalid update entry');
    names.add(file.path.toLowerCase());
    assertNoLinks(root, file.path);
    if (hash(path.join(stage, 'new', ...file.path.split('/'))) !== file.newSha256) throw new Error(`bad staged file: ${file.path}`);
  }
  if (names.has('resources/app.asar') !== names.has('qmclient.exe')) throw new Error('ASAR and EXE must be updated together');
  const backup = path.join(stage, 'backup');
  const journalPath = path.join(stage, 'journal.json');
  const ack = path.join(stage, 'healthy');
  const activePath = path.join(root, '.quenching-client-update', 'active.json');
  const journal = { state: 'installing', files: plan.files.map(file => file.path), replaced: [] };
  await waitUntilGone(oldPid, 60000);
  try {
    fs.mkdirSync(backup, { recursive: true });
    await writeJournal(journalPath, journal);
    for (const file of plan.files) {
      const target = path.join(root, ...file.path.split('/'));
      const saved = path.join(backup, ...file.path.split('/'));
      const next = path.join(stage, 'new', ...file.path.split('/'));
      assertNoLinks(root, file.path);
      if (file.oldSha256 === null ? fs.existsSync(target) : hash(target) !== file.oldSha256) throw new Error(`installed file changed: ${file.path}`);
      if (file.oldSha256 !== null) {
        fs.mkdirSync(path.dirname(saved), { recursive: true });
        fs.copyFileSync(target, saved, fs.constants.COPYFILE_EXCL);
        if (hash(saved) !== file.oldSha256) throw new Error(`backup failed: ${file.path}`);
      }
      // Journal before each replace: recovery can always restore the saved original.
      fs.mkdirSync(path.dirname(target), { recursive: true });
      journal.replaced.push(file.path);
      await writeJournal(journalPath, journal);
      await retry(() => fs.renameSync(next, target + '.quenching-incoming'));
      // rename with an existing destination is atomic on Windows. Keep the
      // original in backup rather than creating a no-EXE gap in the install.
      await retry(() => fs.renameSync(target + '.quenching-incoming', target));
    }
    journal.state = 'awaiting-health';
    await writeJournal(journalPath, journal);
    const childEnv = { ...process.env, QUENCHING_CLIENT_UPDATE_ACK: ack, QUENCHING_CLIENT_UPDATE_TOKEN: plan.token };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const logFd = fs.openSync(path.join(stage, 'new-client.log'), 'a');
    const child = cp.spawn(path.join(root, 'QMClient.exe'), plan.relaunchArgs, {
      // Windows otherwise assigns the new GUI to the helper's kill-on-exit
      // job. unref() alone does not keep it alive when the helper finishes.
      cwd: root, detached: true, stdio: ['ignore', logFd, logFd], windowsHide: false,
      env: childEnv,
    });
    fs.closeSync(logFd);
    child.unref();
    journal.newPid = child.pid;
    await writeJournal(journalPath, journal);
    // Cold startup, antivirus and slower disks can legitimately delay the
    // renderer. Health still requires the exact transaction token.
    const end = Date.now() + 180000;
    while (Date.now() < end) {
      if (fs.existsSync(ack) && fs.readFileSync(ack, 'utf8') === plan.token) {
        journal.state = 'complete';
        await writeJournal(journalPath, journal);
        // Health committed the release. Antivirus/file locks during cleanup
        // must never turn a healthy installation into a rollback.
        try {
          fs.rmSync(activePath, { force: true });
          fs.rmSync(backup, { recursive: true, force: true });
          for (const file of plan.files) {
            const relative = '_tmp/client-update-cache/' + file.newSha256 + '.bin';
            assertNoLinks(root, relative);
            const cached = path.join(root, relative);
            if (fs.existsSync(cached) && hash(cached) === file.newSha256) fs.rmSync(cached);
          }
        } catch (error) { console.warn('Update committed; cleanup will retry later:', String(error)); }
        return;
      }
      if (child.exitCode !== null) {
        journal.newExitCode = child.exitCode;
        await writeJournal(journalPath, journal);
        break;
      }
      await sleep(500);
    }
    if (child.pid && isAlive(child.pid)) {
      cp.spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      await waitUntilGone(child.pid, 15000);
    }
    throw new Error('updated client did not report healthy startup');
  } catch (error) {
    journal.state = 'rolling-back';
    await writeJournal(journalPath, journal);
    await restore(root, stage, journal.replaced);
    for (const file of plan.files.filter(file => file.oldSha256 === null && journal.replaced.includes(file.path))) {
      const target = path.join(root, ...file.path.split('/'));
      if (fs.existsSync(target) && hash(target) === file.newSha256) fs.rmSync(target);
    }
    journal.state = 'rolled-back';
    await writeJournal(journalPath, journal);
    fs.rmSync(activePath, { force: true });
    restartOriginal(root, plan.relaunchArgs);
    throw error;
  }
}
async function recover(planPath, oldPid) {
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const root = path.resolve(plan.root);
  const stage = path.resolve(plan.stage);
  if (path.dirname(stage) !== path.join(root, '.quenching-client-update')) throw new Error('bad recovery location');
  await waitUntilGone(oldPid, 60000);
  const journalPath = path.join(stage, 'journal.json');
  const journal = fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath, 'utf8')) : null;
  if (journal && journal.state !== 'complete' && journal.state !== 'rolled-back') {
    const entries = new Map(plan.files.map(file => [file.path, file]));
    for (const relative of journal.replaced) if (!entries.has(relative)) throw new Error('unrecognized recovery entry');
    await restore(root, stage, journal.replaced);
    for (const relative of journal.replaced) {
      const file = entries.get(relative);
      const target = path.join(root, ...relative.split('/'));
      if (file.oldSha256 === null && fs.existsSync(target) && hash(target) === file.newSha256) fs.rmSync(target);
    }
    journal.state = 'rolled-back';
    await writeJournal(journalPath, journal);
  }
  fs.rmSync(path.join(root, '.quenching-client-update', 'active.json'), { force: true });
  restartOriginal(root, Array.isArray(plan.relaunchArgs) ? plan.relaunchArgs : []);
}
(process.argv[4] === '--recover' ? recover(process.argv[2], Number(process.argv[3])) : run(process.argv[2], Number(process.argv[3]))).catch(error => {
  try { fs.writeFileSync(path.join(path.dirname(process.argv[2]), 'error.txt'), String(error.stack || error)); } catch {}
  process.exitCode = 1;
});
