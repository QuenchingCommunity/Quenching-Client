import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'fs-extra';
import { renameShaderDirectory, replaceLockedShaderFiles } from '../src/Main/services/shader-directory';

const work = path.resolve('_tmp/foliage-lock');
await fs.ensureDir(work);
const root = await fs.mkdtemp(path.join(work, 'shader-lock-'));
const target = path.join(root, 'target');
const prepared = path.join(root, 'prepared');
const backup = path.join(root, 'backup');
const rename = fs.rename;
const copyFile = fs.copyFile;
let retained = false;
const replace = () => replaceLockedShaderFiles(target, prepared, backup, () => { retained = true; });
try {
  await fs.outputFile(path.join(target, 'ps/a.bls'), 'old-a');
  await fs.outputFile(path.join(target, 'ps/b.bls'), 'old-b');
  await fs.outputFile(path.join(target, 'obsolete.bls'), 'old-obsolete');
  await fs.outputFile(path.join(target, 'same.bls'), 'unchanged');
  await fs.outputFile(path.join(target, '.quenching-shader-pack'), 'old-pack');
  await fs.outputFile(path.join(prepared, 'ps/a.bls'), 'new-a');
  await fs.outputFile(path.join(prepared, 'ps/b.bls'), 'new-b');
  await fs.outputFile(path.join(prepared, 'same.bls'), 'unchanged');
  await fs.outputFile(path.join(prepared, '.quenching-shader-pack'), 'new-pack');
  if (process.platform === 'win32') {
    await fs.outputFile(path.join(target, 'MixedCase.bls'), 'old-case');
    await fs.outputFile(path.join(prepared, 'mixedcase.bls'), 'new-case');
  }
  let attempts = 0;
  (fs as any).rename = async () => {
    if (++attempts < 3) throw Object.assign(new Error('transient lock'), { code: 'EBUSY' });
  };
  await renameShaderDirectory(target, backup);
  assert.equal(attempts, 3);
  (fs as any).rename = async () => { attempts++; throw Object.assign(new Error('bad path'), { code: 'ENOENT' }); };
  attempts = 0;
  await assert.rejects(renameShaderDirectory(target, backup), /bad path/);
  assert.equal(attempts, 1);
  (fs as any).rename = rename;

  // Simulate a partial write, after another shader has already changed.
  (fs as any).copyFile = async (from: string, to: string) => {
    if (from === path.join(prepared, 'ps/b.bls')) {
      await fs.writeFile(to, 'partial');
      throw Object.assign(new Error('file locked'), { code: 'EPERM' });
    }
    return copyFile(from, to);
  };
  await assert.rejects(replace(), /file locked/);
  for (const [name, value] of [['ps/a.bls', 'old-a'], ['ps/b.bls', 'old-b'], ['obsolete.bls', 'old-obsolete'], ['.quenching-shader-pack', 'old-pack']]) {
    assert.equal(await fs.readFile(path.join(target, name), 'utf8'), value);
  }
  assert.equal(retained, false);

  (fs as any).copyFile = async (from: string, to: string) => {
    if (from === path.join(prepared, 'ps/b.bls')) throw new Error('write failure');
    if (from === path.join(backup, 'ps/a.bls')) throw new Error('restore failure');
    return copyFile(from, to);
  };
  await assert.rejects(replace(), /backup retained/);
  assert.equal(retained, true);
  assert.equal(await fs.readFile(path.join(backup, 'ps/a.bls'), 'utf8'), 'old-a');
  // Restore the fixture before exercising a successful retry.
  (fs as any).copyFile = copyFile;
  await fs.copy(backup, target);
  retained = false;
  (fs as any).copyFile = async (from: string, to: string) => {
    assert.notEqual(to, path.join(target, 'same.bls'), 'Unchanged files must not be rewritten');
    return copyFile(from, to);
  };
  await replace();
  assert.equal(await fs.readFile(path.join(target, 'ps/a.bls'), 'utf8'), 'new-a');
  assert.equal(await fs.readFile(path.join(target, '.quenching-shader-pack'), 'utf8'), 'new-pack');
  assert(!await fs.pathExists(path.join(target, 'obsolete.bls')));
  if (process.platform === 'win32') assert.equal(await fs.readFile(path.join(target, 'mixedcase.bls'), 'utf8'), 'new-case');
  assert.equal(retained, false);
  console.log('PASS: shader lock retry, file fallback, unchanged files, obsolete removal, partial-write rollback and retained backup');
} finally {
  (fs as any).rename = rename;
  (fs as any).copyFile = copyFile;
  assert(path.resolve(root).startsWith(work + path.sep));
  await fs.remove(root);
}
