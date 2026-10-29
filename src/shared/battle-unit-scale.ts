/** Keep the unscaled skin value in the table so profile switches are reversible.
 * The comment travels with active/parked files and is ignored by Warcraft. */
const NORMAL_SCALE = '// quenching-normal-modelScale:hd=';
export const BATTLE_SPECIAL_UNITS = new Set([
  'hvlt', 'hlum', 'utom', 'uzig', 'uzg1', 'uzg2', 'etrp', 'etol', 'etoa', 'etoe',
  'hmtt', 'hrtt', 'hwt2', 'hwt3', 'hdhw', 'ocat', 'ehip', 'echm', 'ufro', 'emtg',
]);
// These three retain the first revision's reduction; all others shrink 0.02 more.
export const BATTLE_RETAINED_UNITS = new Set(['uabo', 'hkni', 'okod']);

export function hasBattleUnitScales(text: string): boolean {
  return text.includes(NORMAL_SCALE);
}

export function restoreBattleUnitScales(text: string): string {
  return text.replace(/^\/\/ quenching-normal-modelScale:hd=([^\r\n]*)\r?\nmodelScale:hd=[^\r\n]*(\r?\n|$)/gm,
    (_, original: string, newline: string) => original === 'inherit' ? '' : `modelScale:hd=${original}${newline}`);
}

export function applyBattleUnitScales(text: string, enabled: boolean): string {
  const normal = restoreBattleUnitScales(text);
  if (!enabled) return normal;
  const newline = normal.includes('\r\n') ? '\r\n' : '\n';
  return normal.split(/(?=^\[)/m).map(block => {
    const id = /^\[([a-z][A-Za-z0-9]{3})\]/.exec(block)?.[1];
    if (!id) return block; // Hero rawcodes start with an uppercase letter.
    const hd = /^modelScale:hd=([^\r\n]*)/m.exec(block);
    const common = /^modelScale=([^\r\n]*)/m.exec(block);
    const source = hd || common;
    if (!source) return block; // Skin aliases inherit their parent's scale.
    const value = Number(source[1]);
    const delta = BATTLE_RETAINED_UNITS.has(id) ? 0.04 : BATTLE_SPECIAL_UNITS.has(id) ? 0.08 : 0.06;
    if (!Number.isFinite(value) || value <= delta) throw new Error(`Invalid HD battle model scale: ${id}=${source[1]}`);
    const reduced = Math.round((value - delta) * 1e6) / 1e6;
    const lines = `${NORMAL_SCALE}${hd ? hd[1] : 'inherit'}${newline}modelScale:hd=${reduced}`;
    return hd ? block.replace(/^modelScale:hd=[^\r\n]*/m, lines)
      : block.replace(/^modelScale=[^\r\n]*/m, match => `${lines}${newline}${match}`);
  }).join('');
}

export function battleUnitScalesEnabled(profile: string, era: string, settings: unknown): boolean {
  const s = settings as { improveReadability?: boolean; resolvedVersion?: string; objectShader?: boolean; postProcessing?: boolean } | undefined;
  return (profile === 'hd' || profile === 'hd-retro') && era === 'v30' && s?.resolvedVersion === 'v301' &&
    s.improveReadability === true && s.objectShader !== false && s.postProcessing !== false;
}
