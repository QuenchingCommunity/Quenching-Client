import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { reportUpdateFailure } from '../src/Renderer/utils/update-feedback';

const diagnostics: unknown[][] = [];
const original = console.error;
console.error = (...args) => diagnostics.push(args);
try {
  const error = new Error("Error invoking remote method 'mod-update:apply': all artifact sources failed: " +
    'https://gh-proxy.org/https://github.com/UIZorrot/Quenching-Assets/releases/download/3.6/'.repeat(30) +
    'download timed out; self signed certificate');
  const message = reportUpdateFailure(error, (_key, fallback) => fallback!);
  assert.equal(message, '更新失败，请稍后重试或手动下载更新。');
  assert(!message.includes('https://') && !message.includes('Error invoking'));
  assert.equal(diagnostics[0][1], error, 'complete diagnostic remains in the log');
  const translated = reportUpdateFailure(error, key => key === 'msg.update.retry_or_manual' ? 'Short translated update error.' : '');
  assert.equal(translated, 'Short translated update error.');
  const source = await fs.readFile('src/Renderer/components/MainWindow/index.tsx', 'utf8');
  assert(source.includes('Modal.error({'), 'failure remains visible until the user acknowledges it');
  assert.equal((source.match(/showUpdateFailure\(error\)/g) || []).length, 3,
    'client, MOD and combined failures share persistent feedback');
} finally {
  console.error = original;
}
console.log('PASS: short translated notifications; full diagnostics retained; all three update entry points covered');
