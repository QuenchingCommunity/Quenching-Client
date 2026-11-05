import fs from 'fs-extra';
import path from 'node:path';
import { Storage } from '@jamiephan/casclib';
import { openGameCascStorage } from '../src/Main/services/casc-storage';
import { SKIN_CONFIG } from '../src/Renderer/assets/data/skin-config';
import { warbandChoices } from '../src/Renderer/assets/data/skin-panel-catalog';
import { originalSkin, parseSkinSections, scopedSkin } from '../src/shared/skin-versions';
import { modelTextureReferences } from '../src/Main/services/custom-model-textures';

const [gameRoot, packageRoot] = process.argv.slice(2);
if (!gameRoot || !packageRoot) throw Error('Usage: tsx scripts/audit-warband-resources.ts GAME_ROOT PACKAGE_ROOT');
const storage = new Storage();
let failures = 0, checked = 0;
const access = await openGameCascStorage(storage, gameRoot);
try {
  const file = storage.openFile('war3.w3mod:units/unitskin.txt');
  let baseline;
  try { baseline = parseSkinSections(file.readAll().toString('utf8')); } finally { file.close(); }
  for (const [race, catalog] of Object.entries(SKIN_CONFIG)) for (const preset of catalog.warbands.slice(1)) {
    const choices = warbandChoices(race, preset.id);
    console.log(`PRESET ${preset.id} ${preset.name}: ${choices.length} targets`);
    const excluded = [...new Set(preset.config.map(c => c.unitId))].filter(id => !choices.some(c => c.unitId === id));
    if (excluded.length) { failures += excluded.length; console.log(`EXCLUDED: ${excluded.join(', ')}`); }
    for (const choice of choices) {
      checked++;
      const scoped = scopedSkin([...originalSkin(baseline[choice.unitId], 'hd'), ...choice.changes], 'hd');
      for (const change of scoped.filter(c => /^(file|Art):/.test(c.field))) {
        const name = change.value.replace(/\\/g, '/');
        const stem = name.replace(/\.(mdx|mdl|blp|dds)$/i, '');
        const names = change.field.startsWith('file') ? [stem + '.mdx', stem + '.mdl'] : [stem + '.blp', stem + '.dds'];
        const found = [];
        for (const n of names) {
          if (await fs.pathExists(path.join(packageRoot, n))) found.push(`package:${n}`);
          if (storage.fileExists('war3.w3mod:_hd.w3mod:' + n)) found.push(`hd:${n}`);
          if (storage.fileExists('war3.w3mod:' + n)) found.push(`base:${n}`);
        }
        console.log(`${found.length ? 'OK' : 'MISSING'} ${choice.unitId} ${change.field}=${name} ${JSON.stringify(found)}`);
        if (!found.length) failures++;
        if (change.field.startsWith('file') && found.length) {
          let data: Buffer | undefined;
          const local = names.find(n => found.includes(`package:${n}`));
          if (local) data = await fs.readFile(path.join(packageRoot, local));
          else {
            const game = names.find(n => found.includes(`hd:${n}`));
            if (game) { const model = storage.openFile('war3.w3mod:_hd.w3mod:' + game); try { data = model.readAll(); } finally { model.close(); } }
          }
          if (data) for (const ref of modelTextureReferences(local || names[0], data)) {
            const r = ref.replace(/\\/g, '/');
            const variants = (n: string) => /\.tif$/i.test(n) ? [n.replace(/\.tif$/i, '.dds'), n] : /\.blp$/i.test(n) ? [n, n.replace(/\.blp$/i, '.dds')] : [n];
            const candidates = variants(r);
            if (!r.includes('/')) for (const folder of ['Textures', 'ReplaceableTextures']) candidates.push(...variants(`${folder}/${r}`));
            let available = storage.fileExists(ref);
            for (const candidate of candidates) if (await fs.pathExists(path.join(packageRoot, candidate)) ||
              storage.fileExists('war3.w3mod:_hd.w3mod:' + candidate) || storage.fileExists('war3.w3mod:' + candidate)) { available = true; break; }
            if (!available) { failures++; console.log(`MISSING_TEXTURE ${choice.unitId}: ${name} -> ${ref}`); }
          }
        }
      }
      console.log(`FLAGS ${choice.unitId}: ${JSON.stringify(scoped.filter(c => c.field.startsWith('fileVerFlags')))}`);
    }
  }
  console.log(`AUDIT: ${checked} preset targets, ${failures} missing resources`);
  if (failures) process.exitCode = 1;
} finally { storage.close(); access.release(); }
