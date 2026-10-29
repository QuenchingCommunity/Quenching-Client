import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'fs-extra';
import { extractArchive, getArchiveUncompressedBytes, archiveToolPath } from '../src/Main/services/archive-extraction';
import { installPackageSources } from '../src/Main/services/full-package-install';

const work = path.resolve('_tmp/archive-formats');
await fs.ensureDir(work);
const root = await fs.mkdtemp(path.join(work, 'test-'));
const run = promisify(execFile);
const crc32 = (data: Buffer) => {
  let crc = -1;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ -1) >>> 0;
};
// Build tiny, real RAR4 store archives without requiring WinRAR on the test machine.
async function rar4(file: string, files: Record<string, string>, link = false) {
  const header = (type: number, flags: number, body: Buffer) => {
    const h = Buffer.alloc(7 + body.length); h[2] = type; h.writeUInt16LE(flags, 3); h.writeUInt16LE(h.length, 5); body.copy(h, 7);
    h.writeUInt16LE(crc32(h.subarray(2)) & 0xffff); return h;
  };
  const parts = [Buffer.from('526172211a0700', 'hex'), header(0x73, 0, Buffer.alloc(6))];
  for (const [name, value] of Object.entries(files)) {
    const data = Buffer.from(value), filename = Buffer.from(name), body = Buffer.alloc(25 + filename.length);
    body.writeUInt32LE(data.length, 0); body.writeUInt32LE(data.length, 4); body[8] = 3;
    body.writeUInt32LE(crc32(data), 9); body[17] = 20; body[18] = 0x30; body.writeUInt16LE(filename.length, 19);
    body.writeUInt32LE(link ? 0o120777 : 0o100644, 21); filename.copy(body, 25);
    parts.push(header(0x74, 0x8000, body), data);
  }
  parts.push(header(0x7b, 0, Buffer.alloc(0)));
  await fs.writeFile(file, Buffer.concat(parts));
}
async function sevenZip(file: string, source: string, ...extra: string[]) {
  await run(archiveToolPath(), ['a', '-t7z', '-ms=on', '-mx=1', ...extra, file, '.'], { cwd: source, windowsHide: true, maxBuffer: 10000 });
}
try {
  const source = path.join(root, '中文 空格源');
  const contents = { 'QMF3.7/_retail_/units/unitskin.txt': '完整包 skin', 'QMF3.7/_retail_/textures/中文 名称.blp': 'texture 中文', 'QMF3.7/_retail_/shaders/ps/hd.bls': 'shader' };
  for (const [name, value] of Object.entries(contents)) await fs.outputFile(path.join(source, name), value);
  const archive = path.join(root, '中文 solid 包.7z');
  await sevenZip(archive, source);
  const expectedBytes = Object.values(contents).reduce((sum, value) => sum + Buffer.byteLength(value), 0);
  assert.equal(await getArchiveUncompressedBytes(archive), expectedBytes);
  const target = path.join(root, 'game', '_ptr_');
  await fs.outputFile(path.join(target, 'player.txt'), 'keep');
  const progress: number[] = [];
  await installPackageSources([archive], target, percent => progress.push(percent));
  assert.equal(await fs.readFile(path.join(target, 'units/unitskin.txt'), 'utf8'), '完整包 skin');
  assert.equal(await fs.readFile(path.join(target, 'textures/中文 名称.blp'), 'utf8'), 'texture 中文');
  assert.equal(await fs.readFile(path.join(target, 'player.txt'), 'utf8'), 'keep');
  assert.equal(await fs.pathExists(archive), true, 'source archives survive installation');
  assert.equal(progress.at(-1), 98);

  const rar = path.join(root, 'resource.rar');
  await rar4(rar, { 'QMF3.7/_retail_/units/unitskin.txt': 'RAR4 skin' });
  await installPackageSources([rar], target);
  assert.equal(await fs.readFile(path.join(target, 'units/unitskin.txt'), 'utf8'), 'RAR4 skin');
  const rar5 = path.join(root, 'compressed-rar5.rar');
  await fs.writeFile(rar5, Buffer.from(await fs.readFile('scripts/fixtures/archives/compressed-rar5.base64', 'utf8'), 'base64'));
  const rar5Out = path.join(root, 'rar5-out');
  assert.equal(await extractArchive(rar5, rar5Out), 1200);
  assert.equal(crc32(await fs.readFile(path.join(rar5Out, 'test.bin'))), 0x7cca70cd);

  const overwrite = path.join(root, 'overwrite.rar');
  await rar4(overwrite, { 'units/unitskin.txt': 'second archive wins' });
  await installPackageSources([archive, overwrite], target);
  assert.equal(await fs.readFile(path.join(target, 'units/unitskin.txt'), 'utf8'), 'second archive wins');

  const failures = path.join(root, 'failures');
  await fs.outputFile(path.join(failures, 'player.txt'), 'untouched');
  const broken = path.join(root, 'broken.7z'); await fs.writeFile(broken, 'not an archive');
  await assert.rejects(installPackageSources([archive, broken], failures));
  assert.deepEqual(await fs.readdir(failures), ['player.txt'], 'a later broken archive must not modify the game');
  const encrypted = path.join(root, 'encrypted.7z'); await sevenZip(encrypted, source, '-ptest-password', '-mhe=on');
  await assert.rejects(installPackageSources([encrypted], failures), /密码|加密/);
  const traversal = path.join(root, 'traversal.rar'); await rar4(traversal, { '../escape.txt': 'escape' });
  await assert.rejects(installPackageSources([traversal], failures), /不安全路径/);
  assert.equal(await fs.pathExists(path.join(root, 'escape.txt')), false);
  const link = path.join(root, 'link.rar'); await rar4(link, { 'unsafe-link': '../../outside' }, true);
  await assert.rejects(installPackageSources([link], failures), /链接/);
  const client = path.join(root, 'client.rar'); await rar4(client, { 'resources/app.asar': 'wrong package' });
  let prepared = false;
  await assert.rejects(installPackageSources([client], failures, undefined, async () => { prepared = true; }), /客户端文件/);
  assert.equal(prepared, false);
  await assert.rejects(extractArchive(path.join(root, 'other.exe'), failures), /不支持/);
  assert.deepEqual(await fs.readdir(failures), ['player.txt']);
  const linkedParent = path.join(root, 'linked-game');
  const outside = path.join(root, 'outside-staging');
  await fs.outputFile(path.join(outside, 'sentinel.txt'), 'keep outside');
  await fs.ensureDir(linkedParent);
  await fs.symlink(outside, path.join(linkedParent, '_tmp'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(installPackageSources([archive], path.join(linkedParent, '_retail_')), /暂存目录不能是链接/);
  assert.deepEqual(await fs.readdir(outside), ['sentinel.txt']);
  assert.deepEqual(await fs.readdir(path.join(path.dirname(target), '_tmp')), [], 'all transaction directories are cleaned up');
  assert.equal(archiveToolPath('C:\\app\\resources\\app.asar\\node_modules\\7zip-bin-full\\win\\x64\\7z.exe'), 'C:\\app\\resources\\app.asar.unpacked\\node_modules\\7zip-bin-full\\win\\x64\\7z.exe');
  console.log('PASS: solid 7z, RAR4, compressed RAR5; Unicode paths; wrappers; mixed archives; progress; source/custom-file preservation; corrupt/encrypted/traversal/link/client archives rejected; staging cleanup; ASAR path.');
} finally {
  await fs.remove(root);
}
