import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';
import { readSkinTable } from './full-package-sync-utils.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.argv[2] || 'D:/Quenching/QM/Latest');
const assets = path.join(repo, 'assets', 'quenching');
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

async function exists(file) {
  try { await fs.stat(file); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
async function same(a, b) {
  assert.equal(sha(await fs.readFile(a)), sha(await fs.readFile(b)), `${a} differs from ${b}`);
}
async function filesUnder(dir) {
  const files = [];
  async function walk(folder, relative = '') {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic link in audit: ${next}`);
      if (entry.isDirectory()) await walk(path.join(folder, entry.name), next);
      else if (entry.isFile()) files.push(next);
    }
  }
  await walk(dir);
  return files.sort();
}
async function sameTree(a, b) {
  const left = await filesUnder(a);
  const right = await filesUnder(b);
  assert.deepEqual(left, right, `Different file lists: ${a} and ${b}`);
  for (const relative of left) await same(path.join(a, relative), path.join(b, relative));
  return left.length;
}
async function sameComposedTree(target, sources) {
  const expected = new Map();
  for (const { root: source, prefix } of sources) {
    for (const relative of await filesUnder(source)) {
      const targetRelative = path.join(prefix, relative);
      assert.equal(expected.has(targetRelative), false, `Duplicate composed shader path: ${targetRelative}`);
      expected.set(targetRelative, path.join(source, relative));
    }
  }
  const actual = await filesUnder(target);
  assert.deepEqual(actual, [...expected.keys()].sort(), `Different composed file list: ${target}`);
  for (const relative of actual) await same(path.join(target, relative), expected.get(relative));
  return actual.length;
}
async function verifyPublicEnvironment(zipPath, environmentDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zip) => {
      if (openError) return reject(openError);
      let checked = 0;
      zip.on('error', reject);
      zip.on('end', () => resolve(checked));
      zip.on('entry', (entry) => {
        if (entry.fileName.endsWith('/')) return zip.readEntry();
        const relative = entry.fileName.replaceAll('\\', '/');
        if (relative.split('/').some((part) => part === '..' || part === '') || !/^(environmentmap|foliage|sky)\//i.test(relative)) {
          return reject(new Error(`Unexpected environment ZIP entry: ${relative}`));
        }
        zip.openReadStream(entry, async (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks = [];
          try {
            for await (const chunk of stream) chunks.push(chunk);
            const payload = Buffer.concat(chunks);
            assert.equal(payload.length, entry.uncompressedSize, relative);
            assert.equal(sha(payload), sha(await fs.readFile(path.join(environmentDir, ...relative.split('/')))), relative);
            checked += 1;
            zip.readEntry();
          } catch (error) { reject(error); }
        });
      });
      zip.readEntry();
    });
  });
}

for (const relative of [
  '_manual',
  'replaceabletextures/water', 'terrainart/water.slk',
  'textures/shoreline1.dds', 'textures/shorelineparticlexy.dds',
]) assert.equal(await exists(path.join(root, relative)), false, `Unexpected active override: ${relative}`);
for (const relative of [
  'replaceabletextures/water-rel', 'replaceabletextures/water-trans',
  'textures/_setting/shoreline1.dds', 'textures/_setting/shorelineparticlexy.dds',
  'textures/fx/shoreline1.dds', 'textures/fx/shorelineparticlexy.dds',
]) assert.equal(await exists(path.join(root, relative)), true, `Missing optional water asset: ${relative}`);
for (const name of ['water-rel', 'water-trans']) {
  await sameTree(path.join(root, 'replaceabletextures', name), path.join(assets, 'water', name));
}
for (const name of ['shoreline1.dds', 'shorelineparticlexy.dds']) {
  await same(path.join(root, 'textures', 'fx', name), path.join(assets, 'water', 'shoreline', name));
}

await same(path.join(root, 'units/unitskin.txt'), path.join(assets, 'skin/unitskin-new.txt'));
await same(path.join(root, 'PostProcessingConfig.txt'), path.join(assets, 'PostProcessingConfig.txt'));
await same(path.join(root, 'webui/index.html'), path.join(assets, 'index.html'));
await same(path.join(root, 'webui/QuenchingOn.png'), path.join(assets, 'tx/QuenchingOnCN.png'));
assert.equal(await exists(path.join(root, 'units/unitskin2.txt')), false, 'Obsolete unitskin2.txt is still present');
const treeSkin = (await fs.readFile(path.join(root, 'units/destructableskin.txt'), 'utf8')).replaceAll('\\', '/').toLowerCase();
assert.match(treeSkin, /replaceabletextures\/tree\/t20\//);
assert.match(treeSkin, /doodads\/que\/d20\//);
for (const relative of ['doodads/que/d20', 'replaceabletextures/tree/t20']) {
  assert.equal(await exists(path.join(root, relative)), true, `Missing HD tree resource: ${relative}`);
}
const nativeDestructables = readSkinTable(await fs.readFile(path.join(assets, 'skin/destructableskin.txt'), 'utf8'));
const packageDestructables = readSkinTable(await fs.readFile(path.join(root, 'units/destructableskin.txt'), 'utf8'));
assert.deepEqual([...packageDestructables.keys()], [...nativeDestructables.keys()], 'Modern destructable IDs missing or obsolete IDs retained');
const shortTreeOverrides = JSON.parse(await fs.readFile(path.join(repo, 'scripts/fixtures/destructable-short-overrides.json'), 'utf8')).overrides;
const expectedOverrides = new Map();
for (const { section, field, value } of shortTreeOverrides) {
  const baseline = nativeDestructables.get(section);
  assert.ok(baseline, section);
  const key = field === 'texFile' && !baseline.has(field) && baseline.has('texFile:sd') ? 'texFile:sd' : field;
  expectedOverrides.set(`${section}.${key}`, value);
}
for (const id of ['OTip', 'OTis']) expectedOverrides.set(`${id}.file`, '.mdl');
for (const [id, row] of nativeDestructables) {
  const actual = packageDestructables.get(id);
  for (const [field, value] of row) {
    const override = expectedOverrides.get(`${id}.${field}`);
    if (override !== undefined) assert.equal(actual.get(field)?.replaceAll('\\', '/').toLowerCase(), override.replaceAll('\\', '/').toLowerCase(), `${id}.${field}: configured tree/platform changed`);
    else assert.equal(actual.get(field), value, `${id}.${field}: native baseline differs`);
  }
  for (const [field, value] of actual) {
    if (!row.has(field)) assert.equal(value, expectedOverrides.get(`${id}.${field}`), `${id}.${field}: unexpected legacy field`);
  }
}

await same(path.join(root, 'terrainart/terrain.slk'), path.join(assets, 'tile/terrain20.slk'));
await same(path.join(root, 'terrainart/clifftypes.slk'), path.join(assets, 'tile/clifftypes20.slk'));
assert.equal((await fs.readFile(path.join(root, 'terrainart/meta.que'), 'utf8')).trim(), '20');
for (const name of ['ashenvale', 'cityscape', 'cityscaperuins', 'felwood', 'lordaeronfall', 'lordaeronsummer', 'lordaeronwinter', 'village', 'villagefall']) {
  assert.equal(await exists(path.join(root, 'terrainart', name)), false, `t30 terrain still active: ${name}`);
  assert.equal(await exists(path.join(root, 't30', name)), true, `t30 backup missing: ${name}`);
}

const dnc = await sameTree(path.join(root, 'environment/dnc'), path.join(assets, 'dnc/dnc30-hd'));
const activeShaders = await sameComposedTree(path.join(root, 'shaders'), [
  { root: path.join(assets, 'shaders/shaders-300-hd/vs'), prefix: 'vs' },
  { root: path.join(assets, 'shaders/shaders-300-hd/ps/standard'), prefix: 'ps' },
]);
const publicEnvironment = await verifyPublicEnvironment(path.join(assets, 'env-20-30-public.zip'), path.join(root, 'environment'));

console.log(JSON.stringify({ result: 'HD full-package audit passed', baseline: { gameVersion: '3.01', graphics: 'HD', lighting: 'standard', brightness: 3 }, manualResources: 'removed', dncFiles: dnc, activeShaderFiles: activeShaders, publicEnvironmentFiles: publicEnvironment, destructables: packageDestructables.size, preservedOverrides: expectedOverrides.size, water: 'Warcraft default', terrain: 't20/HD', units: 'unitskin/HD', t30: 'parked' }, null, 2));
