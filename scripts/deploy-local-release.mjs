// Local version text only: no network, install inventory, sequence or resource switching.
import fs from 'node:fs/promises';
import path from 'node:path';
import { updateUiVersionText } from './prepare-release-assets.mjs';
import { releaseLabel } from './lib/release-label.mjs';

const release = JSON.parse(await fs.readFile('release-version.json', 'utf8'));
const label = releaseLabel(release);
const game = 'D:/Quenching/War3Reforged/Warcraft III/_retail_';
const backup = path.resolve('logs', `local-release-backup-${Date.now()}`);
const changes = [];
async function write(file, content) {
  const old = await fs.readFile(file).catch(e => { if(e.code === 'ENOENT') return null; throw e; });
  const bytes = Buffer.from(content);
  if (old?.equals(bytes)) return;
  await fs.mkdir(backup, { recursive: true });
  if (old) await fs.writeFile(path.join(backup, `${changes.length}-${path.basename(file)}.before`), old, { flag: 'wx' });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
  changes.push(file);
}
const identity = await fs.readFile('assets/quenching/local-release.json');
await write(path.join(game, '.quenching/local-release.json'), identity);
await write(path.join(game, 'webui/index.html'), await fs.readFile('assets/quenching/index.html'));
async function visit(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(e => { if(e.code === 'ENOENT') return []; throw e; })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (entry.name.toLowerCase() === 'commandbar.fdf') {
      const text = await fs.readFile(file, 'utf8');
      const updated = updateUiVersionText(text, label);
      if (updated.frames) await write(file, updated.text);
    }
  }
}
await visit(path.join(game, 'ui'));
// Keep the actual MOD update baseline while explicitly identifying local tests.
for (const root of ['D:/Quenching/QM/Latest', game]) {
  const marker = path.join(root, '_patch/keep.que');
  const original = await fs.readFile(marker, 'utf8');
  const clean = original.replace(/^\/\/ Local build: [^\r\n]*\r?\n?/gm, '');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  await write(marker, `${clean.replace(/\s+$/, '')}${newline}// Local build: ${label}${newline}`);
}
await fs.mkdir(backup, { recursive: true });
await fs.writeFile(path.join(backup, 'deployment.json'), JSON.stringify({ label, changes, backup, networkChanges: false }, null, 2) + '\n');
console.log(JSON.stringify({ label, changes, backup, networkChanges: false }, null, 2));
