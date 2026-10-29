import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyBattleUnitScales, restoreBattleUnitScales, battleUnitScalesEnabled, BATTLE_SPECIAL_UNITS } from '../src/shared/battle-unit-scale';
import { parseSkinSections, writeVersionSkins, preserveVersionSkins } from '../src/shared/skin-versions';

const normal = fs.readFileSync('assets/unpacked/skin/unitskin-new.txt', 'utf8');
const baseline = parseSkinSections(normal);
const battle = applyBattleUnitScales(normal, true);
assert.equal(applyBattleUnitScales(battle, true), battle, 'repeat application must not shrink again');
assert.equal(restoreBattleUnitScales(battle), normal, 'normal/battle round trip preserves original bytes');
let current = battle;
for (let i = 0; i < 10; i++) current = applyBattleUnitScales(applyBattleUnitScales(current, false), true);
assert.equal(current, battle);
const small = parseSkinSections(battle);
let changed = 0;
for (const [id, fields] of Object.entries(baseline)) {
  if (/^[A-Z]/.test(id)) { assert.deepEqual(small[id], fields); continue; }
  for (const key of Object.keys(fields)) if (key !== 'modelScale:hd') assert.equal(small[id][key], fields[key], `${id}.${key}`);
  if (!fields['modelScale:hd'] && !fields.modelScale) continue;
  const reduction = Number(fields['modelScale:hd'] ?? fields.modelScale) - Number(small[id]['modelScale:hd']);
  const expected = ['uabo', 'hkni', 'okod'].includes(id) ? 0.04 : BATTLE_SPECIAL_UNITS.has(id) ? 0.08 : 0.06;
  assert(Math.abs(reduction - expected) < 1e-8, id);
  changed++;
}
assert.equal(changed, 806);
assert.equal(small.uabo['modelScale:hd'], '0.96');
assert.equal(small.hkni['modelScale:hd'], '0.83');
assert.equal(small.okod['modelScale:hd'], '0.91');

// Ordinary custom skin, special-unit skin, hero skin, and original reset.
const choices = [
  { unitId: 'hfoo', skinId: 'custom', changes: [{ field: 'file', value: 'cos/custom/footman' }, { field: 'modelScale', value: '1.5' }] },
  { unitId: 'hmtt', skinId: 'builtin', changes: [{ field: 'file', value: 'cos/tank' }, { field: 'modelScale', value: '1.2' }] },
  { unitId: 'Hamg', skinId: 'hero', changes: [{ field: 'modelScale', value: '1.3' }] },
];
const selected = writeVersionSkins(battle, baseline, 'hd', choices);
const chosen = parseSkinSections(selected);
assert.equal(chosen.hfoo['file:hd'], 'cos/custom/footman');
assert.equal(chosen.hfoo['modelScale:hd'], '1.44');
assert.equal(chosen.hmtt['file:hd'], 'cos/tank');
assert.equal(chosen.hmtt['modelScale:hd'], '1.12');
assert.equal(chosen.Hamg['modelScale:hd'], '1.3');
assert.equal(parseSkinSections(applyBattleUnitScales(selected, false)).hfoo['modelScale:hd'], '1.5');
const reset = writeVersionSkins(selected, baseline, 'hd', [{ unitId: 'hfoo', skinId: 'original', changes: [] }]);
assert.equal(parseSkinSections(reset).hfoo['modelScale:hd'], '0.89');
assert.equal(parseSkinSections(reset).hmtt['modelScale:hd'], '1.12');
const preserved = preserveVersionSkins(normal, selected, { hd: { hfoo: 'custom', hmtt: 'builtin', Hamg: 'hero' } });
assert.equal(parseSkinSections(preserved).hfoo['modelScale:hd'], '1.5', 'migration must copy unscaled skin values');
assert.equal(parseSkinSections(applyBattleUnitScales(preserved, true)).hmtt['modelScale:hd'], '1.12');
const old = normal.replace('modelScale:de=0.95', 'modelScale:de=0.1');
assert.equal(preserveVersionSkins(normal, old, { de: { Hamg: 'original' } }), normal, 'original choices use the new baseline');
for (const [profile, era, expected] of [
  ['hd', 'v30', true], ['hd-retro', 'v30', true], ['sd', 'v30', false], ['de', 'v30', false], ['hd', 'v20', false],
] as const) {
  for (const lighting of ['standard', 'rpg', 'battle']) assert.equal(battleUnitScalesEnabled(profile, era,
    { resolvedVersion: 'v301', improveReadability: true, lighting }), expected);
  assert.equal(battleUnitScalesEnabled(profile, era, { resolvedVersion: 'v301', lighting: 'battle' }), false);
  assert.equal(battleUnitScalesEnabled(profile, era, { resolvedVersion: 'v30', improveReadability: true }), false);
}
for (const newline of ['\n', '\r\n']) for (const tail of ['', newline]) {
  const fixture = ['[hfoo]', 'modelScale=1', '[hmtt]', 'modelScale:hd=1.2'].join(newline) + tail;
  assert.equal(restoreBattleUnitScales(applyBattleUnitScales(fixture, true)), fixture);
}
console.log('PASS: 806 scale changes match special table; hero/SD/DE isolation; skin inheritance/reset; baseline migration; repeated mode switches and byte round trips');
