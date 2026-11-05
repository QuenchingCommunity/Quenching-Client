import { CUSTOM_SKIN_CONFIG, SKIN_CONFIG, SkinChange } from './skin-config';
import { SkinArtSet, VersionSkinChoice } from '../../../shared/skin-versions';

export interface SkinTarget { unitId: string; name: string; icon: string }
export interface PanelSkin { id: string; name: string; config: SkinChange[]; preview?: string }
const buildings: Record<string, string[][]> = {
  hum: [['htow','城镇大厅'],['hkee','主城'],['hcas','城堡'],['halt','国王祭坛'],['hbar','兵营'],['hhou','农场'],['hbla','铁匠铺'],['harm','车间'],['hars','神秘圣地'],['hgra','狮鹫笼'],['hvlt','神秘藏宝室'],['hwtw','哨塔'],['hgtw','防御塔'],['hctw','炮塔'],['hatw','神秘之塔']],
  orc: [['ogre','大厅'],['ostr','要塞'],['ofrt','堡垒'],['oalt','风暴祭坛'],['obar','兵营'],['otrb','兽族地洞'],['ofor','战争磨坊'],['obea','兽栏'],['osld','灵魂归宿'],['otto','牛头人图腾'],['ovln','巫毒商店'],['owtw','瞭望塔']],
  ud: [['unpl','大墓地'],['unp1','亡者大厅'],['unp2','黑色城堡'],['uaod','黑暗祭坛'],['usep','地穴'],['ugrv','坟场'],['uzig','通灵塔'],['uzg1','幽魂之塔'],['uzg2','蛛网怪塔'],['utod','诅咒神庙'],['uslh','屠宰场'],['ubon','埋骨地'],['utom','古墓废墟'],['ugol','闹鬼金矿']],
  ne: [['etol','生命之树'],['etoa','岁月之树'],['etoe','永恒之树'],['eate','长者祭坛'],['emow','月井'],['edob','猎手大厅'],['eaom','战争古树'],['eaow','风之古树'],['eaoe','知识古树'],['eden','奇迹古树'],['etrp','远古守护者'],['egol','缠绕金矿'],['edos','奇美拉栖木']],
};
const extraUnits: Record<string, string[][]> = {
  hum: [['hmil','民兵'],['hwat','水元素']],
  orc: [['otbk','巨魔狂战士'],['ospm','灵魂行者（虚无）'],['osw1','幽灵狼']],
  ud: [['uskm','骷髅魔法师'],['ucrm','地穴恶魔（钻地）'],['ugrm','石像鬼（石像形态）']],
  ne: [['edcm','利爪德鲁伊（熊形态）'],['edtm','猛禽德鲁伊（风暴乌鸦）'],['efon','树人']],
};
// Historical Electron classic branch exposed skins.slice(0, 2). Only restore alternatives
// whose SD models were verified in the game's base CASC layer; do not reuse HD-only assets.
export const LEGACY_SD_SKINS = new Set(['h1_2','h2_2','h3_2','h4_2','o6_2','u11_2','u12_2','n16_2','t17_2','t18_2','t19_2']);
const compactIcon = (unitId: string) => `skin-icon-${unitId.toLowerCase()}.png`;
function warbandChanges(changes: SkinChange[]): SkinChange[] {
  // A replacement model is a specific asset. Do not inherit the original
  // unit's expansion/variant selection flags (e.g. Sorceress/Catapult).
  // Presets which deliberately select a variant keep their explicit flags.
  return changes.some(c => c.field === 'file' || c.field === 'file:hd') &&
    !changes.some(c => c.field === 'fileVerFlags' || c.field === 'fileVerFlags:hd')
    ? [...changes, { field: 'fileVerFlags', value: '0' }] : changes;
}
export function skinTargets(race: string, category: string): SkinTarget[] {
  if (category === 'hero') return SKIN_CONFIG[race]?.heroes || [];
  if (category === 'building') return (buildings[race] || []).map(([unitId, name]) => ({ unitId, name, icon: compactIcon(unitId) }));
  if (category === 'unit') return [
    ...(CUSTOM_SKIN_CONFIG[race]?.units || []).filter(unit => /^[a-z]/.test(unit.unitId)),
    ...(extraUnits[race] || []).map(([unitId, name]) => ({ unitId, name, icon: compactIcon(unitId) })),
  ];
  return [];
}
export function builtInSkins(race: string, targetId: string, artSet: SkinArtSet): PanelSkin[] {
  if (artSet === 'de') return [];
  const hero = SKIN_CONFIG[race]?.heroes.find(h => h.unitId === targetId);
  if (hero) return hero.skins.slice(1).filter(skin => artSet === 'hd' || LEGACY_SD_SKINS.has(skin.id))
    .map(skin => ({ ...skin, config: artSet === 'sd' ? skin.config.filter(c => !c.field.includes(':')) : skin.config }));
  if (artSet !== 'hd') return [];
  return (SKIN_CONFIG[race]?.warbands || []).filter(w => !w.id.endsWith('_u1'))
    .map(w => ({ id: `${w.id}:${targetId}`, name: w.name, config: warbandChanges(w.config.filter(c => c.unitId === targetId).map(({ field, value }) => ({ field, value }))) }))
    .filter(skin => skin.config.length > 0);
}
export function warbandChoices(race: string, presetId: string) {
  const preset = SKIN_CONFIG[race]?.warbands.find(w => w.id === presetId);
  const targets = new Set([...skinTargets(race, 'unit'), ...skinTargets(race, 'building')].map(t => t.unitId));
  const ids = [...new Set(preset?.config.map(c => c.unitId) || [])].filter(id => targets.has(id));
  return ids.map(unitId => ({ unitId, skinId: presetId.endsWith('_u1') ? 'original' : `${presetId}:${unitId}`, changes: presetId.endsWith('_u1') ? [] : warbandChanges(preset!.config.filter(c => c.unitId === unitId).map(({ field, value }) => ({ field, value }))) }));
}

/** Resolve persisted IDs from the same catalog used for selecting skins. */
export function savedSkinChoices(artSet: SkinArtSet, selections: Record<string, string>,
  custom: Array<{ id: string; targetId: string; artSet?: SkinArtSet; config: SkinChange[] }>) {
  const choices: VersionSkinChoice[] = [];
  const missing: string[] = [];
  for (const [unitId, skinId] of Object.entries(selections)) {
    if (skinId === 'original') { choices.push({ unitId, skinId, changes: [] }); continue; }
    const imported = custom.find(skin => skin.id === skinId && skin.targetId === unitId && (skin.artSet || 'hd') === artSet);
    const builtin = Object.keys(SKIN_CONFIG).flatMap(race => builtInSkins(race, unitId, artSet)).find(skin => skin.id === skinId);
    const config = imported?.config || builtin?.config;
    if (config) choices.push({ unitId, skinId, changes: config.map(change => ({ ...change })) });
    else missing.push(`${artSet}/${unitId}: ${skinId}`);
  }
  return { choices, missing };
}
