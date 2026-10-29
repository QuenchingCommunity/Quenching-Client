import { applyBattleUnitScales, hasBattleUnitScales, restoreBattleUnitScales } from './battle-unit-scale';

export type SkinArtSet = 'sd' | 'hd' | 'de';
export interface VersionSkinChange { field: string; value: string }
export interface VersionSkinChoice { unitId: string; skinId: string; changes: VersionSkinChange[] }
export type SkinSelections = Partial<Record<SkinArtSet, Record<string, string>>>;
export type SkinSections = Record<string, Record<string, string>>;
export const SKIN_FIELDS = ['file', 'Art', 'unitSound', 'modelScale', 'fileVerFlags', 'portrait'];

export function assertArtSet(value: string): asserts value is SkinArtSet {
  if (!['sd', 'hd', 'de'].includes(value)) throw new Error('无效的皮肤版本');
}
export function parseSkinSections(text: string): SkinSections {
  const result: SkinSections = {};
  let section: Record<string, string> | undefined;
  for (const line of text.split(/\r?\n/)) {
    const header = /^\[([^\]]+)\]/.exec(line.trim());
    if (header) section = result[header[1]] = {};
    else if (section && !line.trim().startsWith('//')) {
      const index = line.indexOf('=');
      if (index > 0) section[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
  }
  return result;
}
export function originalSkin(section: Record<string, string> = {}, artSet: SkinArtSet): VersionSkinChange[] {
  return SKIN_FIELDS.map(field => ({ field, value: section[`${field}:${artSet}`] ?? section[field] ?? '' }));
}
/** Old HD catalogs contain both common and :hd rows. Explicit rows win, regardless of order. */
export function scopedSkin(changes: VersionSkinChange[], artSet: SkinArtSet): VersionSkinChange[] {
  assertArtSet(artSet);
  const fields = new Map<string, string>();
  for (const change of changes) {
    if (!change || typeof change.value !== 'string' || /[\r\n\0]/.test(change.value)) throw new Error('无效的皮肤字段值');
    const [field, suffix, extra] = change.field.split(':');
    if (!SKIN_FIELDS.includes(field) || extra || (suffix && !['sd', 'hd', 'de'].includes(suffix))) throw new Error('不支持的皮肤字段');
    if (!suffix) fields.set(field, change.value);
  }
  for (const change of changes) {
    const [field, suffix] = change.field.split(':');
    if (suffix === artSet) fields.set(field, change.value);
  }
  return [...fields].map(([field, value]) => ({ field: `${field}:${artSet}`, value }));
}

/** Replace only the chosen version. More-specific melee/custom qualifiers must not mask it. */
export function writeVersionSkins(text: string, baseline: SkinSections, artSet: SkinArtSet, choices: VersionSkinChoice[]) {
  assertArtSet(artSet);
  if (!Array.isArray(choices) || choices.length === 0 || choices.length > 256) throw new Error('无效的皮肤选择');
  const battle = hasBattleUnitScales(text);
  let lines = restoreBattleUnitScales(text).split(/\r?\n/);
  const seen = new Set<string>();
  for (const choice of choices) {
    if (!/^[A-Za-z0-9]{4}$/.test(choice.unitId) || seen.has(choice.unitId) || !choice.skinId) throw new Error('无效或重复的单位');
    seen.add(choice.unitId);
    if (!baseline[choice.unitId]) throw new Error(`找不到单位原版配置: ${choice.unitId}`);
    const original = choice.skinId === 'original';
    const values = scopedSkin([
      ...originalSkin(baseline[choice.unitId], artSet),
      ...(original ? [] : choice.changes),
    ], artSet).filter(change => change.value !== '');
    const scopedFields = SKIN_FIELDS.map(field => `${field}:${artSet}`.toLowerCase());
    const qualifiedOriginals = original
      ? Object.entries(baseline[choice.unitId]).filter(([key]) =>
          scopedFields.some(field => key.toLowerCase().startsWith(`${field}:`)))
      : [];
    let start = lines.findIndex(line => line.trim() === `[${choice.unitId}]`);
    if (start < 0) { lines.push('', `[${choice.unitId}]`); start = lines.length - 1; }
    let end = start + 1;
    while (end < lines.length && !/^\[.*\]$/.test(lines[end].trim())) end++;
    const block = lines.slice(start + 1, end).filter(line => {
      const key = line.split('=')[0].trim();
      return !scopedFields.some(field => key.toLowerCase() === field || key.toLowerCase().startsWith(`${field}:`));
    });
    lines.splice(start + 1, end - start - 1,
      ...values.map(c => `${c.field}=${c.value}`),
      ...qualifiedOriginals.map(([key, value]) => `${key}=${value}`),
      ...block);
  }
  return applyBattleUnitScales(lines.join('\r\n'), battle);
}

/** Retain explicit per-version choices when the legacy global resource pack rebuilds its template. */
export function preserveVersionSkins(replacement: string, previous: string, selections: SkinSelections) {
  const sections = parseSkinSections(restoreBattleUnitScales(previous));
  let result = replacement;
  for (const artSet of ['sd', 'hd', 'de'] as const) {
    const choices = Object.entries(selections[artSet] || {}).filter(([id, skinId]) => skinId !== 'original' && sections[id]).map(([unitId, skinId]) => ({
      unitId, skinId, changes: Object.entries(sections[unitId]).filter(([field]) => SKIN_FIELDS.some(base => field === `${base}:${artSet}`)).map(([field, value]) => ({ field, value })),
    })).filter(choice => choice.changes.length > 0);
    if (choices.length) result = writeVersionSkins(result, sections, artSet, choices);
  }
  return result;
}
