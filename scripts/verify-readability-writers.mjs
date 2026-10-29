/** Verify the actual HD writer, rather than treating a FOW carrier as a team tag. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

export function hdTeamWriterCoverage(data) {
  if (data.toString('ascii', 0, 4) !== 'HSXG') throw new Error('Invalid HD BLS header');
  const count = data.readUInt32LE(12), start = data.readUInt32LE(16);
  if (count !== 2048 || start !== 24 + count * 4) throw new Error('Unsupported 3.01 HD layout');
  const cache = new Map(); let cursor = start, writers = 0;
  for (let index = 0; index < count; index++) {
    const record = cursor; cursor += 80;
    if (data.toString('ascii', cursor, cursor + 4) !== 'DXBC') throw new Error('Missing HD DXBC');
    const size = data.readUInt32LE(cursor + 24), end = cursor + size;
    if (end > data.length || data.readUInt32LE(record + 72) !== size || data.readUInt32LE(24 + index * 4) !== end - start) throw new Error('Invalid HD BLS entry bounds');
    const blob = data.subarray(cursor, end), key = sha(blob);
    if (!cache.has(key)) {
      let code;
      for (let j = 0; j < blob.readUInt32LE(28); j++) {
        const offset = blob.readUInt32LE(32 + j * 4), tag = blob.toString('ascii', offset, offset + 4);
        if (tag === 'SHEX' || tag === 'SHDR') code = blob.subarray(offset + 8, offset + 8 + blob.readUInt32LE(offset + 4));
      }
      if (!code || code.readUInt32LE(4) * 4 !== code.length) throw new Error('Invalid shader program');
      let ormQuery = false, teamMagic = false;
      for (let offset = 8; offset < code.length;) {
        const token = code.readUInt32LE(offset), opcode = token & 2047;
        const words = opcode === 53 ? code.readUInt32LE(offset + 4) : (token >>> 24) & 127;
        const next = offset + words * 4;
        if (!words || next > code.length) throw new Error('Invalid shader instruction');
        // resinfo t2 qualifies the material-wide ORM alpha. The RGB444
        // phase-zero magic is a scalar immediate 13 in movc, not a register
        // number or the shift-by-13 used by the unrelated FOW signature.
        if (opcode === 61 && code.readUInt32LE(next - 4) === 2) ormQuery = true;
        if (opcode === 55) for (let k = offset + 4; k + 8 <= next; k += 4) {
          if (code.readUInt32LE(k) === 0x4001 && code.readUInt32LE(k + 4) === 13) teamMagic = true;
        }
        offset = next;
      }
      cache.set(key, ormQuery && teamMagic);
    }
    writers += Number(cache.get(key)); cursor = end;
  }
  if (cursor !== data.length) throw new Error('Trailing HD BLS data');
  return { variants: count, teamWriters: writers };
}

export async function verifyReadabilityWriters(shaderRoot) {
  const root = path.join(shaderRoot, 'readability-301');
  const index = await fs.readFile(path.join(root, 'profiles.json'), 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!index) return { skipped: true, reason: 'No readability profiles in this resource fixture' };
  if (index.schema !== 1 || !Object.keys(index.profiles || {}).length) throw new Error('Invalid readability index');
  const cache = new Map(), profiles = {};
  for (const [key, entry] of Object.entries(index.profiles)) {
    if (!/^\w+$/.test(key)) throw new Error('Unsafe readability profile key');
    const data = await fs.readFile(path.join(root, key, 'ps/hd.bls')), digest = sha(data);
    if (!cache.has(digest)) cache.set(digest, hdTeamWriterCoverage(data));
    const coverage = cache.get(digest);
    if (coverage.teamWriters !== 256) throw new Error(`Readability ${key} has ${coverage.teamWriters}/256 team writers; native FOW visibility is not a team-color writer`);
    for (const name of ['hd.bls', 'fog.bls', 'volumetricfog.bls']) {
      const actual = name === 'hd.bls' ? digest : sha(await fs.readFile(path.join(root, key, 'ps', name)));
      if (actual !== entry.files?.[`ps/${name}`]) throw new Error(`Readability ${key}/${name} index hash mismatch`);
    }
    profiles[key] = coverage;
  }
  return { passed: true, profiles };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/unpacked/shaders');
  console.log(JSON.stringify(await verifyReadabilityWriters(root)));
}
