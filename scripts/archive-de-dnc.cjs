// Read only from CASC. Keep the unmodified DE models and the extracted rotation
// data together so the experimental option can be audited without the game.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { Storage } = require('@jamiephan/casclib');

const game = process.argv[2];
const destination = process.argv[3];
if (!game || !destination) throw new Error('Usage: node scripts/archive-de-dnc.cjs <game-root> <new-backup-directory>');
if (fs.existsSync(destination)) throw new Error('Backup destination must be new');
const storage = new Storage();
const models = [];
const units = {};
const sourceRoot = 'assets/unpacked/dnc/dnc30-de';
storage.open(`${path.resolve(game)}*w3`);
try {
  for (const set of fs.readdirSync(sourceRoot).sort()) {
    if (!fs.statSync(path.join(sourceRoot, set)).isDirectory()) continue;
    for (const part of fs.readdirSync(path.join(sourceRoot, set)).sort()) {
      if (!fs.statSync(path.join(sourceRoot, set, part)).isDirectory()) continue;
      const relative = `${set}/${part}/${part}.mdx`;
      const casc = `war3.w3mod:_de.w3mod:environment\\dnc\\${relative.replaceAll('/', '\\')}`;
      assert(storage.fileExists(casc), `Missing original DE file: ${casc}`);
      const file = storage.openFile(casc);
      let bytes;
      try { bytes = Buffer.from(file.readAll()); } finally { file.close(); }
      assert.equal(bytes.toString('ascii', 0, 4), 'MDLX');
      const chunks = new Map();
      for (let offset = 4; offset < bytes.length;) {
        const size = bytes.readUInt32LE(offset + 4);
        assert(offset + 8 + size <= bytes.length);
        chunks.set(bytes.toString('ascii', offset, offset + 4), bytes.subarray(offset + 8, offset + 8 + size));
        offset += 8 + size;
      }
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const record = { relative, casc, bytes: bytes.length, sha256, formatVersion: chunks.get('VERS').readUInt32LE(0) };
      models.push({ ...record, content: bytes });
      if (!part.endsWith('unit') || ['dncdungeon', 'dncunderground'].includes(set)) continue;
      const sequence = chunks.get('SEQS');
      assert.equal(sequence.length, 132, 'Exactly one animation is expected');
      const interval = [sequence.readUInt32LE(80), sequence.readUInt32LE(84)];
      const light = chunks.get('LITE');
      assert.equal(light.readUInt32LE(0), light.length, 'Exactly one light is expected');
      const nodeSize = light.readUInt32LE(4);
      const objectId = light.readInt32LE(88);
      assert.equal(objectId, 0);
      assert.equal(light.readInt32LE(92), -1, 'Light must not inherit rotation');
      assert.equal(light.toString('ascii', 100, 104), 'KGRT');
      const count = light.readUInt32LE(104);
      assert.equal(light.readUInt32LE(108), 1, 'Only linear interpolation is supported');
      assert.equal(light.readInt32LE(112), -1, 'Rotation must use the animation interval');
      assert.equal(nodeSize, 96 + 16 + count * 20, 'No other node animation may be copied');
      const keyframes = Array.from({ length: count }, (_, i) => {
        const offset = 116 + i * 20;
        return { frame: light.readUInt32LE(offset), value: Array.from({ length: 4 }, (_, j) => light.readFloatLE(offset + 4 + j * 4)) };
      });
      assert(new Set(keyframes.map(key => JSON.stringify(key.value))).size > 1, 'Source must rotate');
      assert(keyframes.every(key => key.frame >= interval[0] && key.frame <= interval[1]));
      units[relative.replace(/\.mdx$/, '.mdl')] = { sourceSha256: sha256, objectId, interval, keyframes };
    }
  }
} finally { storage.close(); }
assert.equal(Object.keys(units).length, 4);
const buildInfo = fs.readFileSync(path.join(game, '.build.info'), 'utf8');
const builds = buildInfo.trim().split(/\r?\n/).slice(1).map(line => line.split('|'))
  .filter(fields => fields[1] === '1' && fields[14] === 'w3')
  .map(fields => ({ product: fields[14], version: fields[12], buildKey: fields[2] }));
assert.equal(builds.length, 1, 'The *w3 CASC product must have one active build');
const manifest = {
  extractedAt: new Date().toISOString(), gameRoot: path.resolve(game), layer: 'war3.w3mod:_de.w3mod:',
  buildInfoSha256: crypto.createHash('sha256').update(buildInfo).digest('hex'),
  builds,
  versions: builds.map(build => build.version),
  scope: 'Original DE overrides corresponding to every DNC model shipped by the client; no loose game overrides read.',
  models: models.map(({ content, ...record }) => record),
};
const rotations = { schemaVersion: 1, sourceVersion: manifest.versions.join(', '), units };
for (const { relative, content } of models) {
  const output = path.join(destination, relative);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, content, { flag: 'wx' });
}
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(destination, 'unit-rotations.json'), JSON.stringify(rotations, null, 2) + '\n');
console.log(`Archived ${models.length} original DE models, ${Object.keys(units).length} surface unit rotation tracks: ${destination}`);
