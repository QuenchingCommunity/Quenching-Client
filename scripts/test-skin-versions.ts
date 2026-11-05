import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Storage } from '@jamiephan/casclib';
import { originalSkin, parseSkinSections, scopedSkin, writeVersionSkins, preserveVersionSkins } from '../src/shared/skin-versions';
import { SKIN_CONFIG } from '../src/Renderer/assets/data/skin-config';
import { builtInSkins, skinTargets, warbandChoices, LEGACY_SD_SKINS } from '../src/Renderer/assets/data/skin-panel-catalog';

const baseline = parseSkinSections('[hfoo]\nfile=original\nArt=original-icon\nunitSound=Footman\nmodelScale:sd=1\nmodelScale:hd=1.2\nmodelScale:de=0.95\n[htow]\nfile=townhall\n');
const before = '[hfoo]\nfile=legacy\nfile:hd=hd-choice\nfile:de=de-choice\nfile:sd:melee,V0=shadowed\nArt:sd=previous-icon\nunitSound:sd=previous-sound\nother=keep\n[htow]\nfile=unchanged\n';
const sd = writeVersionSkins(before, baseline, 'sd', [{ unitId: 'hfoo', skinId: 'custom-sd', changes: [{ field: 'file', value: 'new-sd' }] }]);
const section = parseSkinSections(sd).hfoo;
assert.equal(section['file:sd'], 'new-sd');
assert.equal(section['file:hd'], 'hd-choice');
assert.equal(section['file:de'], 'de-choice');
assert.equal(section.file, 'legacy');
assert.equal(section['Art:sd'], 'original-icon');
assert.equal(section['unitSound:sd'], 'Footman');
assert.equal(section['file:sd:melee,V0'], undefined);
assert.equal(section.other, 'keep');
assert.equal(parseSkinSections(sd).htow.file, 'unchanged');
const restored = parseSkinSections(writeVersionSkins(sd, baseline, 'sd', [{ unitId: 'hfoo', skinId: 'original', changes: [] }]));
assert.equal(restored.hfoo['file:sd'], 'original');
assert.equal(restored.hfoo['file:hd'], 'hd-choice');
const retro = parseSkinSections(preserveVersionSkins('[hfoo]\nfile=retro\n[htow]\nfile=retro-building', sd, { sd: { hfoo: 'custom-sd' } }));
assert.equal(retro.hfoo['file:sd'], 'new-sd');
assert.equal(retro.hfoo.file, 'retro');
assert.equal(retro.htow.file, 'retro-building');
assert.deepEqual(scopedSkin([{ field: 'file:hd', value: 'specific' }, { field: 'file', value: 'common' }], 'hd'), [{ field: 'file:hd', value: 'specific' }]);
assert.throws(() => writeVersionSkins(before, baseline, 'bad' as any, []));
assert.throws(() => writeVersionSkins(before, baseline, 'hd', [{ unitId: 'hfoo', skinId: 'x', changes: [{ field: 'file', value: 'bad\n[hack]' }] }]));
assert.throws(() => writeVersionSkins(before, baseline, 'hd', [{ unitId: 'fake', skinId: 'x', changes: [] }]));
let sdCount = 0;
for (const race of Object.keys(SKIN_CONFIG)) {
  for (const category of ['unit', 'building', 'hero']) {
    const targets = skinTargets(race, category);
    assert.equal(new Set(targets.map(t => t.unitId)).size, targets.length);
    for (const target of targets) {
      assert.equal(builtInSkins(race, target.unitId, 'de').length, 0);
      const sdSkins = builtInSkins(race, target.unitId, 'sd');
      if (category !== 'hero') assert.equal(sdSkins.length, 0);
      sdCount += sdSkins.length;
    }
  }
  for (const preset of SKIN_CONFIG[race].warbands) {
    const choices = warbandChoices(race, preset.id);
    assert(choices.length > 0);
    for (const choice of choices) assert(/^[a-z]/.test(choice.unitId), 'Warbands must not mutate hero skins');
    if (!preset.id.endsWith('_u1')) for (const choice of choices) {
      assert.deepEqual(builtInSkins(race, choice.unitId, 'hd').find(s => s.id === choice.skinId)?.config, choice.changes);
    }
  }
}
assert.equal(sdCount, LEGACY_SD_SKINS.size);
const elves = warbandChoices('hum', 'h_u3');
assert.equal(scopedSkin(elves.find(c => c.unitId === 'hsor')!.changes, 'hd').find(c => c.field === 'fileVerFlags:hd')?.value, '0',
  'high elf Sorceress must not inherit the standard Sorceress variant flags');
assert.equal(scopedSkin(elves.find(c => c.unitId === 'hmtt')!.changes, 'hd').find(c => c.field === 'fileVerFlags:hd')?.value, '2',
  'explicit steam engine variant flags are preserved');
assert.equal(skinTargets('neutral', 'hero').length, 9);
assert(skinTargets('neutral', 'hero').some(hero => hero.unitId === 'Npal'));
assert.equal(skinTargets('neutral', 'unit').length, 0);

// 3.0 has mode-specific fields and some sections intentionally omit fields.
// A skin choice must not add empty overrides or discard original qualifiers.
const text30 = fs.readFileSync(path.join('assets', 'unpacked', 'skin', 'unitskin-new.txt'), 'utf8');
const baseline30 = parseSkinSections(text30);
const noSound = writeVersionSkins(text30, baseline30, 'hd', [
  { unitId: 'osp1', skinId: 'custom', changes: [{ field: 'file', value: 'cos/custom/model' }] },
]);
assert.equal(parseSkinSections(noSound).osp1['unitSound:hd'], undefined);
const deChoice = writeVersionSkins(text30, baseline30, 'de', [
  { unitId: 'hmpr', skinId: 'custom', changes: [{ field: 'file', value: 'cos/custom/priest' }] },
]);
assert.equal(parseSkinSections(deChoice).hmpr['Art:de'], undefined);
assert.equal(parseSkinSections(deChoice).hmpr['file:de'], 'cos/custom/priest');
const qualifiedId = Object.keys(baseline30).find(id => baseline30[id]['Art:hd:melee,V0']);
assert(qualifiedId, '3.0 template should contain a qualified HD icon');
const changedQualified = writeVersionSkins(text30, baseline30, 'hd', [
  { unitId: qualifiedId, skinId: 'custom', changes: [{ field: 'Art', value: 'CustomIcon.blp' }] },
]);
assert.equal(parseSkinSections(changedQualified)[qualifiedId]['Art:hd:melee,V0'], undefined);
const restoredQualified = writeVersionSkins(changedQualified, baseline30, 'hd', [
  { unitId: qualifiedId, skinId: 'original', changes: [] },
]);
assert.equal(parseSkinSections(restoredQualified)[qualifiedId]['Art:hd:melee,V0'], baseline30[qualifiedId]['Art:hd:melee,V0']);

// Optional read-only verification against an installed game. Never writes to the installation.
if (process.argv[2]) {
  const storage = new Storage();
  storage.open(process.argv[2] + '*w3');
  try {
    const file = storage.openFile('war3.w3mod:units\\unitskin.txt');
    let sections;
    try { sections = parseSkinSections(file.readAll().toString('utf8')); } finally { file.close(); }
    let targets = 0;
    for (const race of Object.keys(SKIN_CONFIG)) for (const category of ['unit', 'building', 'hero']) {
      for (const target of skinTargets(race, category)) {
        assert(sections[target.unitId], `Missing CASC section: ${target.unitId} (${target.name})`);
        for (const mode of ['sd','hd','de'] as const) assert(originalSkin(sections[target.unitId], mode).find(c => c.field === 'file')?.value);
        for (const skin of builtInSkins(race, target.unitId, 'sd')) {
          const model = skin.config.find(c => c.field === 'file')!.value;
          assert(storage.fileExists('war3.w3mod:' + model + '.mdx'), `Missing SD model: ${model}`);
        }
        targets++;
      }
    }
    console.log(`CASC verified: ${targets} melee targets; ${sdCount} historical SD alternatives`);
  } finally { storage.close(); }
}
console.log('PASS: version isolation, original fallback/reset, qualifier removal, input validation, melee roster, SD/DE catalogs, warband expansion');
