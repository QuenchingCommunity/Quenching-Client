import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import archiver from 'archiver';
import { installPackageArchives, installPackageSources, resolvePackageArchives } from '../src/Main/services/full-package-install';

const work = path.resolve('_tmp/archive-formats');
await fs.ensureDir(work);
const root = await fs.mkdtemp(path.join(work, 'zip-install-test-'));
async function zip(file: string, contents: Record<string, string>) {
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(file);
    const archive = archiver('zip', { zlib: { level: 1 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const [name, data] of Object.entries(contents)) archive.append(data, { name });
    void archive.finalize();
  });
}
try {
  const a = path.join(root, 'QMF3.5-Full-A.zip');
  const b = path.join(root, 'QMF3.5-Full-B.zip');
  await zip(a, {
    '_patch/keep.que': '-v3.5-\n',
    // This deliberately is not an integrity manifest. Installation ignores it.
    '_patch/qmf-3.5.files.json.gz': 'stale metadata',
    'shaders/ps/hd.bls': 'shader A', 'textures/shared.txt': 'first',
  });
  await zip(b, { 'units/unitskin.txt': 'skin B', 'textures/shared.txt': 'second' });
  assert.deepEqual(await resolvePackageArchives(a), [a, b]);
  assert.deepEqual(await resolvePackageArchives(b), [b, a]);
  const target = path.join(root, '_retail_');
  await fs.outputFile(path.join(target, 'units/player-custom.txt'), 'keep me');
  const progress: number[] = [];
  await installPackageArchives(await resolvePackageArchives(a), target, p => progress.push(p));
  assert.equal(await fs.readFile(path.join(target, 'shaders/ps/hd.bls'), 'utf8'), 'shader A');
  assert.equal(await fs.readFile(path.join(target, 'units/unitskin.txt'), 'utf8'), 'skin B');
  assert.equal(await fs.readFile(path.join(target, 'textures/shared.txt'), 'utf8'), 'second');
  assert.equal(await fs.readFile(path.join(target, 'units/player-custom.txt'), 'utf8'), 'keep me');
  assert.equal(await fs.pathExists(path.join(target, 'environment/environmentmap/portraits/portraitdefault_ibl.dds')), false);
  assert.equal(progress.at(-1), 98);

  const single = path.join(root, 'old-single.zip');
  await zip(single, { 'QMF3.5/_patch/keep.que': '-v3.5-\n', 'QMF3.5/units/unitskin.txt': 'single ZIP' });
  await installPackageArchives(await resolvePackageArchives(single), target);
  assert.equal(await fs.readFile(path.join(target, 'units/unitskin.txt'), 'utf8'), 'single ZIP');
  const loneA = path.join(root, 'one-download', 'QMF3.5-Full-A.zip');
  await fs.ensureDir(path.dirname(loneA));
  await fs.copy(a, loneA);
  assert.deepEqual(await resolvePackageArchives(loneA), [loneA], 'a selected ZIP must work without its optional sibling');
  await installPackageSources([loneA], target);
  assert.equal(await fs.readFile(path.join(target, 'shaders/ps/hd.bls'), 'utf8'), 'shader A');
  await installPackageSources([a, b], target);
  assert.equal(await fs.readFile(path.join(target, 'units/unitskin.txt'), 'utf8'), 'skin B');
  // A ZIP with no marker and no file list can supplement an existing package.
  await installPackageArchives([b], target);
  assert.equal(await fs.readFile(path.join(target, 'units/unitskin.txt'), 'utf8'), 'skin B');

  const folder = path.join(root, 'extracted', 'QMF3.5');
  await fs.outputFile(path.join(folder, 'units/unitskin.txt'), 'folder skin');
  await fs.outputFile(path.join(folder, 'textures/model.blp'), 'folder texture');
  await fs.outputFile(path.join(folder, 'QMF3.5-Full-A.zip'), 'do not install a nested download');
  let prepared = 0;
  await installPackageSources([path.dirname(folder)], target, undefined, async () => { prepared++; });
  assert.equal(prepared, 1);
  assert.equal(await fs.readFile(path.join(target, 'units/unitskin.txt'), 'utf8'), 'folder skin');
  assert.equal(await fs.readFile(path.join(folder, 'units/unitskin.txt'), 'utf8'), 'folder skin');
  assert.equal(await fs.readFile(path.join(target, 'units/player-custom.txt'), 'utf8'), 'keep me');
  assert.equal(await fs.pathExists(path.join(target, 'QMF3.5-Full-A.zip')), false);

  const client = path.join(root, 'QMC3.5-Win.zip');
  await zip(client, { 'resources/app.asar': 'not a real asar', 'QMClient.exe': 'client' });
  await assert.rejects(installPackageSources([client], target, undefined, async () => { prepared++; }), /客户端文件.*不是 MOD 资源包/);
  assert.equal(prepared, 1, 'rejecting a client archive must not enable or mutate the branch');
  const clientFolder = path.join(root, 'client-folder');
  await fs.outputFile(path.join(clientFolder, 'resources/app.asar'), 'not a real asar');
  await assert.rejects(installPackageSources([clientFolder], target), /客户端文件/);
  assert.equal(await fs.readFile(path.join(target, 'units/unitskin.txt'), 'utf8'), 'folder skin');

  const broken = path.join(root, 'broken.zip');
  await fs.writeFile(broken, 'not a ZIP');
  const failedTarget = path.join(root, 'failed-target');
  await fs.outputFile(path.join(failedTarget, 'player.txt'), 'untouched');
  await assert.rejects(installPackageArchives([a, broken], failedTarget));
  assert.deepEqual(await fs.readdir(failedTarget), ['player.txt']);
  console.log('PASS: A/B and folder installation; sources/custom files preserved; wrong client ZIP/folder rejected before mutation; failed extraction leaves target unchanged.');

  if (process.argv.includes('--real')) {
    const source = 'D:/Quenching/QM/3.5/QMF3.5';
    const realTarget = path.join(root, 'real-target');
    await fs.outputFile(path.join(realTarget, 'units/player-custom.txt'), 'keep real custom');
    let last = -1;
    const bytes = await installPackageArchives(await resolvePackageArchives(path.join(source, 'QMF3.5-Full-A.zip')), realTarget, p => {
      const bucket = Math.floor(p / 20);
      if (bucket !== last) { last = bucket; console.log(`Real A/B installation: ${p}%`); }
    });
    let count = 0;
    const visit = async (dir: string) => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) await visit(path.join(dir, entry.name));
        else if (entry.isFile()) count++;
      }
    };
    await visit(realTarget);
    assert.equal(count, 9026); // 9025 archived files plus the player's file.
    assert.equal(bytes, 7637721693);
    for (const relative of ['units/unitskin.txt', 'shaders/ps/hd.bls', '_patch/keep.que']) {
      const hash = async (dir: string) => crypto.createHash('sha256').update(await fs.readFile(path.join(dir, relative))).digest('hex');
      assert.equal(await hash(realTarget), await hash(source));
    }
    assert.equal(await fs.readFile(path.join(realTarget, 'units/player-custom.txt'), 'utf8'), 'keep real custom');
    console.log(`PASS: Real GitHub A/B ZIPs installed ${count - 1} files (${bytes} bytes); key resources match and custom file survives.`);
  }
} finally {
  await fs.remove(root);
}
