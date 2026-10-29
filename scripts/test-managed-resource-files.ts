import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { installBundledResourceFile, mutateManagedResourceFiles, removeBundledResourceFile, syncBundledResourceFiles } from '../src/Main/services/managed-resource-files';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'quenching-managed-test-'));
const hd = path.join(root, 'client', 'hd');
const de = path.join(root, 'client', 'de');
const target = path.join(root, 'game', 'shaders');
const marker = '.quenching-shader-profile';
const own = (dir: string, name: string) => path.join(dir, 'ps', name);

try {
  await fs.outputFile(own(hd, 'hd.bls'), 'HD supplied by client');
  await fs.outputFile(own(hd, 'fog.bls'), 'HD fog supplied by client');
  await fs.outputFile(own(de, 'hd.bls'), 'DE supplied by client');
  await fs.outputFile(own(target, 'player-extra.bls'), 'player custom shader');
  await fs.outputJson(path.join(target, marker), { schema: 1 });

  // Equality checks must not add a separate streaming/hash pass.
  const readStream = fs.createReadStream;
  (fs as any).createReadStream = () => { throw new Error('Resource sync must not hash files'); };
  try {
    await syncBundledResourceFiles(target, [{ source: hd }], [{ source: hd }, { source: de }], marker);
  } finally {
    (fs as any).createReadStream = readStream;
  }
  assert.equal(await fs.readFile(own(target, 'hd.bls'), 'utf8'), 'HD supplied by client');
  assert.equal(await fs.readFile(own(target, 'fog.bls'), 'utf8'), 'HD fog supplied by client');
  assert.equal(await fs.readFile(own(target, 'player-extra.bls'), 'utf8'), 'player custom shader');
  assert.equal(await fs.pathExists(path.join(target, marker)), false);

  const unchanged = own(target, 'hd.bls');
  const timestamp = new Date('2020-01-01T00:00:00Z');
  await fs.utimes(unchanged, timestamp, timestamp);
  await syncBundledResourceFiles(target, [{ source: hd }], [{ source: hd }, { source: de }], marker);
  assert.equal((await fs.stat(unchanged)).mtimeMs, timestamp.getTime(), 'identical resources must not be deleted or rewritten');

  // Switching variants deletes known paths the new variant lacks; unknown files stay.
  const progress: number[][]=[];
  await syncBundledResourceFiles(target, [{ source: de }], [{ source: hd }, { source: de }], marker, {
    onProgress:(completed,total)=>{
      progress.push([completed,total]);
      if(completed>=1)assert(!fs.existsSync(own(target,'fog.bls')),'deletion reported only after completion');
      if(completed===2)assert.equal(fs.readFileSync(own(target,'hd.bls'),'utf8'),'DE supplied by client','copy reported only after completion');
    },
  });
  assert.deepEqual(progress,[[0,2],[1,2],[2,2]]);
  assert.equal(await fs.readFile(own(target, 'hd.bls'), 'utf8'), 'DE supplied by client');
  assert.equal(await fs.pathExists(own(target, 'fog.bls')), false);
  assert.equal(await fs.readFile(own(target, 'player-extra.bls'), 'utf8'), 'player custom shader');

  // A same-name file is overwritten with the bundled variant.
  await fs.outputFile(own(target, 'hd.bls'), 'player edited the same name');
  await syncBundledResourceFiles(target, [{ source: hd }], [{ source: hd }, { source: de }], marker);
  assert.equal(await fs.readFile(own(target, 'hd.bls'), 'utf8'), 'HD supplied by client');

  assert.equal(await removeBundledResourceFile(target, 'ps/hd.bls', [], marker), true);
  assert.equal(await fs.pathExists(own(target, 'hd.bls')), false);
  assert.equal(await fs.readFile(own(target, 'player-extra.bls'), 'utf8'), 'player custom shader');

  // Disabling removes the bundled script and leaves an unrelated player script.
  const scriptsSource = path.join(root, 'client', 'scripts');
  const scriptsTarget = path.join(root, 'game', 'scripts');
  await fs.outputFile(path.join(scriptsSource, 'blizzard.j'), 'bundled script');
  await fs.outputFile(path.join(scriptsTarget, 'custom.j'), 'player custom script');
  await syncBundledResourceFiles(scriptsTarget, [{ source: scriptsSource }], [{ source: scriptsSource }], '.managed-scripts');
  assert.equal(await fs.readFile(path.join(scriptsTarget, 'blizzard.j'), 'utf8'), 'bundled script');
  await syncBundledResourceFiles(scriptsTarget, [], [{ source: scriptsSource }], '.managed-scripts');
  assert.equal(await fs.pathExists(path.join(scriptsTarget, 'blizzard.j')), false);
  assert.equal(await fs.readFile(path.join(scriptsTarget, 'custom.j'), 'utf8'), 'player custom script');

  // removeAbsent: false only adds files.
  await fs.outputFile(path.join(scriptsTarget, 'blizzard.j'), 'stale script');
  await syncBundledResourceFiles(scriptsTarget, [], [{ source: scriptsSource }], '.managed-scripts', { removeAbsent: false });
  assert.equal(await fs.readFile(path.join(scriptsTarget, 'blizzard.j'), 'utf8'), 'stale script');

  // A missing bundled source is an error, not a silent no-op.
  await assert.rejects(
    syncBundledResourceFiles(scriptsTarget, [{ source: path.join(root, 'client', 'missing') }], [], '.managed-missing'),
    /Bundled resource directory is unavailable/,
  );

  const dncSource = path.join(root, 'client', 'dnc');
  const dncTarget = path.join(root, 'game', 'environment', 'dnc');
  await fs.outputFile(path.join(dncSource, 'sun.mdl'), 'bundled light');
  await fs.outputFile(path.join(dncTarget, 'notes.txt'), 'unrelated');
  await syncBundledResourceFiles(dncTarget, [{ source: dncSource }], [{ source: dncSource }], '.managed-dnc');
  await mutateManagedResourceFiles(dncTarget, '.managed-dnc', name => name.endsWith('.mdl'), async file => {
    await fs.writeFile(file, 'generated bundled light');
  });
  assert.equal(await fs.readFile(path.join(dncTarget, 'sun.mdl'), 'utf8'), 'generated bundled light');
  assert.equal(await fs.readFile(path.join(dncTarget, 'notes.txt'), 'utf8'), 'unrelated');
  await syncBundledResourceFiles(dncTarget, [{ source: dncSource }], [{ source: dncSource }], '.managed-dnc');
  assert.equal(await fs.readFile(path.join(dncTarget, 'sun.mdl'), 'utf8'), 'bundled light');

  const slkSource = path.join(root, 'client', 'terrain20.slk');
  const slkVariant = path.join(root, 'client', 'terrain18.slk');
  const slkTargetDir = path.join(root, 'game', 'terrainart');
  await fs.outputFile(slkSource, 'terrain 20');
  await fs.outputFile(slkVariant, 'terrain 18');
  await fs.outputFile(path.join(slkTargetDir, 'terrain.slk'), 'player terrain table');
  await installBundledResourceFile(slkTargetDir, 'terrain.slk', slkSource, [], '.managed-terrain');
  assert.equal(await fs.readFile(path.join(slkTargetDir, 'terrain.slk'), 'utf8'), 'terrain 20');
  await installBundledResourceFile(slkTargetDir, 'terrain.slk', slkVariant, [], '.managed-terrain');
  assert.equal(await fs.readFile(path.join(slkTargetDir, 'terrain.slk'), 'utf8'), 'terrain 18');
  assert.equal(await removeBundledResourceFile(slkTargetDir, 'terrain.slk', [], '.managed-terrain'), true);
  assert.equal(await fs.pathExists(path.join(slkTargetDir, 'terrain.slk')), false);

  const tilesSource = path.join(root, 'client', 't30', 'ashenvale');
  const tilesTarget = path.join(root, 'game', 'terrainart');
  await fs.outputFile(path.join(tilesSource, 'rocks', 'stone.mdx'), 'bundled tile');
  await fs.outputFile(path.join(tilesTarget, 'ashenvale', 'rocks', 'stone.mdx'), 'player edited tile');
  await fs.outputFile(path.join(tilesTarget, 'ashenvale', 'rocks', 'my-rock.mdx'), 'player tile');
  await syncBundledResourceFiles(tilesTarget, [], [{ source: tilesSource, targetPrefix: 'ashenvale' }], '.managed-tiles');
  assert.equal(await fs.pathExists(path.join(tilesTarget, 'ashenvale', 'rocks', 'stone.mdx')), false);
  assert.equal(await fs.readFile(path.join(tilesTarget, 'ashenvale', 'rocks', 'my-rock.mdx'), 'utf8'), 'player tile');

  console.log('Managed resource replacement checks passed');
} finally {
  await fs.remove(root);
}
