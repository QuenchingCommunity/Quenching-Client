import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { applyDncLighting } from '../src/Main/services/dnc-lighting';

const dncRoot = path.join(process.cwd(), 'assets', 'quenching', 'dnc');
const hd = path.join(dncRoot, 'dnc30-hd');
const deRpg = path.join(dncRoot, 'dnc30-de-rpg');

async function listMdl(root: string, dir = root): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await listMdl(root, full));
    else if (entry.name.toLowerCase().endsWith('.mdl')) found.push(path.relative(root, full));
  }
  return found.sort();
}

function intensities(content: string): number[] {
  const values: number[] = [];
  let inIntensity = false;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    const staticMatch = line.match(/^static\s+Intensity\s+([\d.-]+)/i);
    if (staticMatch) values.push(parseFloat(staticMatch[1]));
    if (/^Intensity\s+\d+\s*\{/i.test(line)) { inIntensity = true; continue; }
    if (inIntensity) {
      const key = line.match(/^\d+:\s*([\d.-]+),?$/);
      if (key) values.push(parseFloat(key[1]));
      else if (line.startsWith('}')) inIntensity = false;
    }
  }
  return values;
}

// The retired archive is historical and must not be compared with the newly finalized HD baseline.
const hdFiles = await listMdl(deRpg);
// In game DE RPG runs as standard on 3.0: only Intensity changes, never Amb/Shadow.
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dnc-de-rpg-'));
try {
  await fs.copy(deRpg, temp);
  await applyDncLighting(temp, 'standard', 3, { deMode: true, isVersion30: true });
  for (const rel of hdFiles) {
    const before = await fs.readFile(path.join(deRpg, rel), 'utf8');
    const after = await fs.readFile(path.join(temp, rel), 'utf8');
    const pick = (text: string) => [...text.matchAll(/static\s+(?:Amb|Shadow)Intensity\s+([\d.-]+)/gi)].map(m => parseFloat(m[1]));
    const [b, a] = [pick(before), pick(after)];
    assert.equal(a.length, b.length, rel);
    b.forEach((value, i) => assert.ok(Math.abs(a[i] - value) < 0.006, `${rel} ambient/shadow ${value} -> ${a[i]}`));
  }
} finally {
  await fs.remove(temp);
}

console.log(`dnc30-de-rpg OK (${hdFiles.length} files)`);

// Retired selections must produce exactly Standard output, for both HD and DE.
const retiredRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dnc-retired-rpg-'));
try {
  for (const deMode of [false, true]) {
    const source = path.join(dncRoot, deMode ? 'dnc30-de' : 'dnc30-hd');
    const standard = path.join(retiredRoot, String(deMode), 'standard');
    const retired = path.join(retiredRoot, String(deMode), 'rpg');
    await fs.copy(source, standard); await fs.copy(source, retired);
    await applyDncLighting(standard, 'standard', 3, { deMode, isVersion30: true });
    await applyDncLighting(retired, 'rpg', 3, { deMode, isVersion30: true });
    for (const rel of await listMdl(source)) assert.equal(await fs.readFile(path.join(retired, rel), 'utf8'), await fs.readFile(path.join(standard, rel), 'utf8'), 'retired RPG must match Standard: ' + rel);
  }
} finally { await fs.remove(retiredRoot); }
console.log('Retired RPG falls back to Standard for HD and DE');
