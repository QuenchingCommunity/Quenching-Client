// Builds assets/unpacked/dnc/dnc30-de-rpg: the 3.0 HD DNC with every Intensity ×1.15.
// Re-run after dnc30-hd changes: npx tsx scripts/build-dnc-de-rpg.ts
import path from 'node:path';
import fs from 'fs-extra';
import { applyBrightnessToIntensity } from '../src/Main/services/dnc-lighting';

const BASELINE_MULTIPLIER = 1.15;
const dncRoot = path.join(process.cwd(), 'assets', 'quenching', 'dnc');
const source = path.join(dncRoot, 'dnc30-hd');
const target = path.join(dncRoot, 'dnc30-de-rpg');

async function listFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await listFiles(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

await fs.remove(target);
let scaled = 0;
for (const file of await listFiles(source)) {
  const destination = path.join(target, path.relative(source, file));
  await fs.ensureDir(path.dirname(destination));
  if (!file.toLowerCase().endsWith('.mdl')) {
    await fs.copy(file, destination);
    continue;
  }
  const content = await fs.readFile(file, 'utf8');
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  if (applyBrightnessToIntensity(lines, BASELINE_MULTIPLIER)) scaled += 1;
  await fs.writeFile(destination, lines.join(eol), 'utf8');
}
console.log(`dnc30-de-rpg built from dnc30-hd: ${scaled} files scaled ×${BASELINE_MULTIPLIER}`);
