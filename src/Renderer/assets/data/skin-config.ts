export interface SkinChange {
  field: string;
  value: string;
}

export interface HeroSkinConfig {
  id: string;
  unitId: string;
  name: string;
  icon: string;
  skins: {
    id: string;
    name: string;
    preview: string;
    config: SkinChange[];
  }[];
}

export interface UnitSkinChange {
  unitId: string;
  field: string;
  value: string;
}

export interface WarbandSkinConfig {
  id: string;
  name: string;
  preview: string;
  config: UnitSkinChange[];
}

export interface RaceConfig {
  id: string;
  name: string;
  heroes: HeroSkinConfig[];
  warbands: WarbandSkinConfig[];
}

export interface CustomSkinUnit {
  unitId: string;
  name: string;
  icon: string;
}

export interface CustomSkinTarget {
  unitId: string;
  name: string;
  icon: string;
}

/** Buildings exposed by the melee race pages. IDs match unitskin.txt sections. */
export const BUILDING_SKIN_CONFIG: Record<string, { name: string; buildings: CustomSkinTarget[] }> = {
  hum: { name: '人类', buildings: [
    { unitId: 'halt', name: '国王祭坛', icon: 'btnaltarofkings.png' },
    { unitId: 'hars', name: '奥术圣所', icon: 'btnarcanevault.png' },
    { unitId: 'hbar', name: '人类兵营', icon: 'btnhumanbarracks.png' },
    { unitId: 'hkee', name: '城堡', icon: 'btnkeep.png' },
    { unitId: 'htow', name: '城镇大厅', icon: 'btntownhall.png' },
    { unitId: 'hhou', name: '农场', icon: 'btnfarm.png' },
    { unitId: 'hwtw', name: '哨塔', icon: 'btnwatchtower.png' },
  ] },
  orc: { name: '兽族', buildings: [
    { unitId: 'oalt', name: '风暴祭坛', icon: 'btnaltarofstorms.png' },
    { unitId: 'obar', name: '兽族兵营', icon: 'btnorcishbarracks.png' },
    { unitId: 'ogre', name: '兽栏', icon: 'btnbeastiary.png' },
    { unitId: 'otot', name: '兽族大厅', icon: 'btnorctownhall.png' },
    { unitId: 'owtw', name: '瞭望塔', icon: 'btnwatchtower.png' },
  ] },
  ud: { name: '不死族', buildings: [
    { unitId: 'uaod', name: '黑暗祭坛', icon: 'btnaltarofdarkness.png' },
    { unitId: 'usep', name: '地穴', icon: 'btncrypt.png' },
    { unitId: 'ugrv', name: '坟场', icon: 'btngraveryard.png' },
    { unitId: 'unpl', name: '城堡', icon: 'btnnecropolis.png' },
    { unitId: 'uzig', name: '通灵塔', icon: 'btnziggurat.png' },
  ] },
  ne: { name: '暗夜精灵', buildings: [
    { unitId: 'eate', name: '长者祭坛', icon: 'btnaltarofelders.png' },
    { unitId: 'etol', name: '生命之树', icon: 'btnentangledgoldmine.png' },
    { unitId: 'edob', name: '月井', icon: 'btnmoonwell.png' },
    { unitId: 'edot', name: '猎手大厅', icon: 'btnhunters hall.png' },
    { unitId: 'etoa', name: '远古之树', icon: 'btntreeofages.png' },
  ] },
  neutral: { name: '中立', buildings: [] },
};

export const CUSTOM_SKIN_CONFIG: Record<string, { name: string, units: CustomSkinUnit[] }> = {
  hum: {
    name: '人类',
    units: [
      { unitId: 'hpea', name: '农民', icon: 'btnpeasant.png' },
      { unitId: 'hfoo', name: '步兵', icon: 'btnfootman.png' },
      { unitId: 'hrif', name: '火枪手', icon: 'btnrifleman.png' },
      { unitId: 'hkni', name: '骑士', icon: 'btnknight.png' },
      { unitId: 'hmtm', name: '迫击炮小队', icon: 'btnmortarteam.png' },
      { unitId: 'hgyr', name: '直升机', icon: 'btngyrocopter.png' },
      { unitId: 'hgry', name: '狮鹫骑士', icon: 'btngryphonrider.png' },
      { unitId: 'hdhw', name: '龙鹰骑士', icon: 'btndragonhawkriderv1.png' },
      { unitId: 'hmpr', name: '牧师', icon: 'btnpriest.png' },
      { unitId: 'hsor', name: '女巫', icon: 'btnsorceress.png' },
      { unitId: 'hmtt', name: '攻城坦克', icon: 'btnseigeengine.png' },
      { unitId: 'hspt', name: '破法者', icon: 'btnspellbreaker.png' },
      { unitId: 'Hamg', name: '大法师', icon: 'btnheroarchmage.png' },
      { unitId: 'Hpal', name: '圣骑士', icon: 'btnheropaladin.png' },
      { unitId: 'Hmkg', name: '山丘之王', icon: 'btnheromountainking.png' },
      { unitId: 'Hblm', name: '血法师', icon: 'btnherobloodelfprince.png' },
    ]
  },
  orc: {
    name: '兽族',
    units: [
      { unitId: 'opeo', name: '苦工', icon: 'btnpeon.png' },
      { unitId: 'ogru', name: '步兵', icon: 'btngrunt.png' },
      { unitId: 'ohun', name: '巨魔猎头者', icon: 'btnheadhunter.png' },
      { unitId: 'ocat', name: '粉碎者', icon: 'btndemolisher.png' },
      { unitId: 'orai', name: '掠夺者', icon: 'btnraider.png' },
      { unitId: 'okod', name: '科多兽', icon: 'btnkotobeast.png' },
      { unitId: 'owyv', name: '风骑士', icon: 'btnwyvernrider.png' },
      { unitId: 'otbr', name: '巨魔蝙蝠骑士', icon: 'btntrollbatrider.png' },
      { unitId: 'ospw', name: '灵魂行者', icon: 'btnspiritwalker.png' },
      { unitId: 'otau', name: '牛头人', icon: 'btntauren.png' },
      { unitId: 'oshm', name: '萨满祭司', icon: 'btnshaman.png' },
      { unitId: 'odoc', name: '巫医', icon: 'btnwitchdoctor.png' },
      { unitId: 'Obla', name: '剑圣', icon: 'btnheroblademaster.png' },
      { unitId: 'Ofar', name: '先知', icon: 'btnherofarseer.png' },
      { unitId: 'Otch', name: '牛头人酋长', icon: 'btntaurenchieftain.png' },
      { unitId: 'Oshd', name: '暗影猎手', icon: 'btnshadowhunter.png' },
    ]
  },
  ud: {
    name: '不死族',
    units: [
      { unitId: 'uaco', name: '侍僧', icon: 'btnacolyte.png' },
      { unitId: 'ugho', name: '食尸鬼', icon: 'btnghoul.png' },
      { unitId: 'ucry', name: '地穴恶魔', icon: 'btncryptfiend.png' },
      { unitId: 'ugar', name: '石像鬼', icon: 'btngargoyle.png' },
      { unitId: 'umtw', name: '绞肉车', icon: 'btnmeatwagon.png' },
      { unitId: 'uabo', name: '憎恶', icon: 'btnabomination.png' },
      { unitId: 'uobs', name: '黑曜石雕像', icon: 'btnobsidianstatue.png' },
      { unitId: 'unec', name: '死灵法师', icon: 'btnnecromancer.png' },
      { unitId: 'uban', name: '女妖', icon: 'btnbanshee.png' },
      { unitId: 'ufro', name: '冰霜巨龙', icon: 'btnfrostwyrm.png' },
      { unitId: 'ubsp', name: '毁灭者', icon: 'btndestroyer.png' },
      { unitId: 'uske', name: '骷髅战士', icon: 'btnskeletonwarrior.png' },
      { unitId: 'Udea', name: '死亡骑士', icon: 'btnherodeathknight.png' },
      { unitId: 'Udre', name: '恐惧魔王', icon: 'btnherodreadlord.png' },
      { unitId: 'Ulic', name: '巫妖', icon: 'btnherolich.png' },
      { unitId: 'Ucrl', name: '地穴领主', icon: 'btnherocryptlord.png' },
    ]
  },
  ne: {
    name: '暗夜精灵',
    units: [
      { unitId: 'ewsp', name: '小精灵', icon: 'btnwisp.png' },
      { unitId: 'earc', name: '弓箭手', icon: 'btnarcher.png' },
      { unitId: 'esen', name: '女猎手', icon: 'btnhuntress.png' },
      { unitId: 'ebal', name: '弩车', icon: 'btnglaivethrower.png' },
      { unitId: 'edry', name: '树妖', icon: 'btndryad.png' },
      { unitId: 'edoc', name: '利爪德鲁伊', icon: 'btndruidoftheclaw.png' },
      { unitId: 'emtg', name: '山岭巨人', icon: 'btnmountaingiant.png' },
      { unitId: 'efdr', name: '精灵龙', icon: 'btnfaeriedragon.png' },
      { unitId: 'ehip', name: '角鹰兽', icon: 'btnhippogriff.png' },
      { unitId: 'ehpr', name: '角鹰兽骑士', icon: 'btnhippogriffrider.png' },
      { unitId: 'edot', name: '猛禽德鲁伊', icon: 'btndruidofthetalon.png' },
      { unitId: 'echm', name: '奇美拉', icon: 'btnchimaera.png' },
      { unitId: 'Edem', name: '恶魔猎手', icon: 'btnherodemonhunter.png' },
      { unitId: 'Emoo', name: '月之女祭司', icon: 'btnheromoonpriestess.png' },
      { unitId: 'Ekee', name: '丛林守护者', icon: 'btnkeeperofthegrove.png' },
      { unitId: 'Ewar', name: '守望者', icon: 'btnherowarden.png' },
    ]
  },
  neutral: {
    name: '中立',
    units: [
      { unitId: 'Nbst', name: '兽王', icon: 'p01.png' },
      { unitId: 'Nbrn', name: '黑暗游侠', icon: 'p02.png' },
      { unitId: 'Nngs', name: '娜迦海妖', icon: 'btnnagaseawitch.png' },
      { unitId: 'Nalc', name: '炼金术士', icon: 'p15.png' },
      { unitId: 'Npbm', name: '熊猫酒仙', icon: 'p056.png' },
      { unitId: 'Nfir', name: '火焰领主', icon: 'p055.png' },
      { unitId: 'Ntin', name: '修补匠', icon: 'p054.png' },
      { unitId: 'Nplh', name: '深渊领主', icon: 'p053.png' },
      { unitId: 'Npal', name: '被遗忘的圣骑士', icon: 'skin-icon-npal.png' },
    ]
  }
};

export const SKIN_CONFIG: Record<string, RaceConfig> = {
  hum: {
    id: 'hum',
    name: '人类',
    warbands: [
      {
        id: 'h_u1',
        name: '原版',
        preview: 'cosu_h1.png',
        config: [
          { unitId: 'hfoo', field: 'file', value: 'units\\human\\Footman\\footman' },
          { unitId: 'hkni', field: 'file', value: 'units\\human\\Knight\\Knight' },
          { unitId: 'hsor', field: 'file', value: 'units\\human\\Sorceress\\Sorceress' },
          { unitId: 'hmtt', field: 'file', value: 'units\\human\\WarWagon\\WarWagon' },
          { unitId: 'hmpr', field: 'file', value: 'units\\human\\Priest\\Priest' },
          { unitId: 'hrif', field: 'file', value: 'units\\human\\Rifleman\\Rifleman' },
          { unitId: 'hpea', field: 'file', value: 'units\\human\\Peasant\\Peasant' },
          { unitId: 'hmil', field: 'file', value: 'units\\human\\Militia\\Militia' },
        ]
      },
      {
        id: 'h_u2',
        name: '联盟精锐',
        preview: 'cosu_h2.png',
        config: [
          { unitId: 'hfoo', field: 'file', value: 'cos\\hum1\\footman' },
          { unitId: 'hkni', field: 'file', value: 'cos\\hum1\\Knight' },
          { unitId: 'hsor', field: 'file', value: 'cos\\hum1\\IsakariMystic' },
          { unitId: 'hmtt', field: 'file', value: 'Units\\Creeps\\WarCart\\WarCart' },
          { unitId: 'hmpr', field: 'file', value: 'Units\\Creeps\\Chaplain\\Chaplain' },
          { unitId: 'hrif', field: 'file', value: 'cos\\hum1\\HMv6' },
        ]
      },
      {
        id: 'h_u3',
        name: '高等精灵战团',
        preview: 'cosu_h3.png',
        config: [
          { unitId: 'hfoo', field: 'file', value: 'units\\Human\\HighElfSwordsman\\HighElfSwordsman_v1.mdl' },
          { unitId: 'hfoo', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNSwordsman.blp' },
          { unitId: 'hfoo', field: 'unitSound', value: 'HighElfSwordsman' },
          { unitId: 'hkni', field: 'file', value: 'cos\\hum2\\BloodElfKnight' },
          { unitId: 'hkni', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNBloodElfLieutenant.blp' },
          { unitId: 'hkni', field: 'unitSound', value: 'ElfWizard' },
          { unitId: 'hsor', field: 'file', value: 'cos\\hum2\\Sorceress' },
          { unitId: 'hsor', field: 'Art:hd', value: 'ReplaceableTextures\\CommandButtons\\BTNSorceressV1.blp' },
          { unitId: 'hmtt', field: 'file', value: 'units\\human\\WarWagon\\WarWagon' },
          { unitId: 'hmtt', field: 'fileVerFlags', value: '2' },
          { unitId: 'hmpr', field: 'file', value: 'cos\\hum2\\highelfrunner.mdx' },
          { unitId: 'hmpr', field: 'fileVerFlags', value: '0' },
          { unitId: 'hmpr', field: 'modelScale:hd', value: '1' },
          { unitId: 'hmpr', field: 'Art:hd', value: 'ReplaceableTextures\\CommandButtons\\BTNPriestV1.blp' },
          { unitId: 'hrif', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNRifleman.blp' },
          { unitId: 'hrif', field: 'file', value: 'units\\human\\Rifleman\\Rifleman' },
          { unitId: 'hpea', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNElfVillager.blp' },
          { unitId: 'hpea', field: 'file', value: 'units\\critters\\HighElfPeasant\\HighElfPeasant' },
          { unitId: 'hpea', field: 'unitSound', value: 'BloodElfEngineer' },
          { unitId: 'hmil', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNBloodElfPeasant.blp' },
          { unitId: 'hmil', field: 'file', value: 'cos\\hum2\\BloodElfEngineer.mdl' },
          { unitId: 'hmil', field: 'modelScale:hd', value: '1.07' },
          { unitId: 'hmil', field: 'unitSound', value: 'BloodElfEngineer' },
        ]
      }
    ],
    heroes: [
      {
        id: 'archmage',
        unitId: 'Hamg',
        name: '大法师',
        icon: 'btnheroarchmage.png',
        skins: [
          {
            id: 'h1_1',
            name: '原版',
            preview: 'cosh_h13.png',
            config: [
              { field: 'file', value: 'units\\human\\HeroArchMage\\HeroArchMage' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroArchMage.blp' },
              { field: 'unitSound', value: 'HeroArchMage' },
              { field: 'modelScale:hd', value: '1.05' }
            ]
          },
          {
            id: 'h1_2',
            name: '吉安娜',
            preview: 'cosh_h14.png',
            config: [
              { field: 'file', value: 'units\\human\\Jaina\\Jaina' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNJaina.blp' },
              { field: 'unitSound', value: 'Jaina' },
              { field: 'modelScale:hd', value: '1.15' }
            ]
          },
          {
            id: 'h1_3',
            name: '高等精灵大法师',
            preview: 'cosh_h12.png',
            config: [
              { field: 'file', value: 'Units\\Other\\HighElfArchMage\\HighElfArchMage' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNHighElfArchMage.blp' },
              { field: 'unitSound', value: 'HeroArchMage' },
              { field: 'modelScale:hd', value: '1.05' }
            ]
          },
          {
            id: 'h1_4',
            name: '安东尼达斯',
            preview: 'cosh_h19.png',
            config: [
              { field: 'file', value: 'Units\\Human\\Antonidas\\Antonidas' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNAntonidas.blp' },
              { field: 'unitSound', value: 'HeroArchMage' },
              { field: 'modelScale:hd', value: '1.05' }
            ]
          },
          {
            id: 'h1_5',
            name: '海之女儿吉安娜',
            config: [
              { field: 'file:hd', value: 'Units\\Human\\JainaSea\\JainaSea' },
              { field: 'unitSound', value: 'Jaina' },
              { field: 'modelScale:hd', value: '1.15' }
            ]
          }
        ]
      },
      {
        id: 'paladin',
        unitId: 'Hpal',
        name: '圣骑士',
        icon: 'btnheropaladin.png',
        skins: [
          {
            id: 'h2_1',
            name: '原版',
            preview: 'cosh_h18.png',
            config: [
              { field: 'file', value: 'units\\human\\HeroPaladin\\HeroPaladin' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroPaladin.blp' },
              { field: 'unitSound', value: 'HeroPaladin' },
              { field: 'modelScale:hd', value: '1.2' }
            ]
          },
          {
            id: 'h2_2',
            name: '乌瑟尔',
            preview: 'cosh_h6.png',
            config: [
              { field: 'file', value: 'units\\human\\Uther\\Uther' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNUther.blp' },
              { field: 'unitSound', value: 'Uther' },
              { field: 'modelScale:hd', value: '1.3' }
            ]
          },
          {
            id: 'h2_3',
            name: '阿尔萨斯',
            preview: 'cosh_h4.png',
            config: [
              { field: 'file', value: 'units\\human\\Arthas\\Arthas' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNArthas.blp' },
              { field: 'unitSound', value: 'Arthas' },
              { field: 'modelScale:hd', value: '1.3' }
            ]
          },
          {
            id: 'h2_4',
            name: '霜哀阿尔萨斯',
            preview: 'cosh_h5.png',
            config: [
              { field: 'file', value: 'units\\human\\ArthaswithSword\\ArthaswithSword' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNArthasFrost.blp' },
              { field: 'unitSound', value: 'Arthas' },
              { field: 'modelScale:hd', value: '1.3' }
            ]
          },
          {
            id: 'h2_5',
            name: '尼古拉斯·布赞',
            preview: 'cosh_h3.png',
            config: [
              { field: 'file', value: 'units\\human\\HeroPaladinBoss\\HeroPaladinBoss' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNLordNicholasBuzan.blp' },
              { field: 'unitSound', value: 'HeroPaladin' },
              { field: 'modelScale:hd', value: '1.3' }
            ]
          },
          {
            id: 'h2_6',
            name: '达格伦',
            preview: 'cosh_h2.png',
            config: [
              { field: 'file', value: 'units\\Human\\HeroDagren\\HeroDagren' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNDagrenTheOrcSlayer.blp' },
              { field: 'unitSound', value: 'HeroPaladin' },
              { field: 'modelScale:hd', value: '1.3' }
            ]
          },
          {
            id: 'h2_7',
            name: '马格罗斯',
            preview: 'cosh_h1.png',
            config: [
              { field: 'file', value: 'units\\Human\\HeroMagroth\\HeroMagroth' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNMagrothTheDefender.blp' },
              { field: 'unitSound', value: 'HeroPaladin' },
              { field: 'modelScale:hd', value: '1.3' }
            ]
          },
          {
            id: 'h2_8',
            name: '哈拉克',
            preview: 'cosh_h15.png',
            config: [
              { field: 'file', value: 'units\\Human\\HeroHalahk\\HeroHalahk' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNHalahkTheLifeBringer.blp' },
              { field: 'unitSound', value: 'HeroPaladin' },
              { field: 'modelScale:hd', value: '1.3' }
            ]
          },
          {
            id: 'h2_9',
            name: '格雷戈里',
            preview: 'cosh_h16.png',
            config: [
              { field: 'file', value: 'units\\human\\HeroPaladinBoss2\\HeroPaladinBoss2' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNSirGregoryEdmunson.blp' },
              { field: 'unitSound', value: 'HeroPaladin' },
              { field: 'modelScale:hd', value: '1.3' }
            ]
          },
          {
            id: 'h2_10',
            name: '戴林·普罗德摩尔',
            preview: 'cosh_h17.png',
            config: [
              { field: 'file', value: 'units\\other\\Proudmoore\\Proudmoore' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNProudMoore.blp' },
              { field: 'unitSound', value: 'HeroPaladin' },
              { field: 'modelScale:hd', value: '1.3' }
            ]
          }
        ]
      },
      {
        id: 'mountainking',
        unitId: 'Hmkg',
        name: '山丘之王',
        icon: 'btnheromountainking.png',
        skins: [
          {
            id: 'h3_1',
            name: '原版',
            preview: 'cosh_h9.png',
            config: [
              { field: 'file', value: 'units\\human\\HeroMountainKing\\HeroMountainKing' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroMountainKing.blp' },
              { field: 'unitSound', value: 'HeroMountainKing' },
              { field: 'modelScale:hd', value: '1.3' }
            ]
          },
          {
            id: 'h3_2',
            name: '穆拉丁',
            preview: 'cosh_h8.png',
            config: [
              { field: 'file', value: 'units\\human\\Muradin\\Muradin' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNMuradinBronzeBeard.blp' },
              { field: 'unitSound', value: 'Muradin' },
              { field: 'modelScale:hd', value: '1.2' }
            ]
          },
          {
            id: 'h3_3',
            name: '黑铁队长',
            preview: 'cosh_h7.png',
            config: [
              { field: 'file', value: 'cos\\DarkIronCaptain\\DarkIronCaptain' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNDarkIronCaptain' },
              { field: 'unitSound', value: 'HeroMountainKing' },
              { field: 'modelScale:hd', value: '1.3' }
            ]
          }
        ]
      },
      {
        id: 'bloodmage',
        unitId: 'Hblm',
        name: '血法师',
        icon: 'btnherobloodelfprince.png',
        skins: [
          {
            id: 'h4_1',
            name: '原版',
            preview: 'cosh_h11.png',
            config: [
              { field: 'file', value: 'units\\human\\HeroBloodElf\\HeroBloodElf' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroBloodElfPrince.blp' },
              { field: 'unitSound', value: 'BloodElfSorceror' },
              { field: 'modelScale:hd', value: '1.2' }
            ]
          },
          {
            id: 'h4_2',
            name: '凯尔',
            preview: 'cosh_h10.png',
            config: [
              { field: 'file', value: 'units\\human\\Kael\\Kael' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNBloodMage2.blp' },
              { field: 'unitSound', value: 'Kael' },
              { field: 'modelScale:hd', value: '1.2' }
            ]
          }
        ]
      }
    ]
  },
  orc: {
    id: 'orc',
    name: '兽族',
    warbands: [
      {
        id: 'o_u1',
        name: '原版',
        preview: 'cosu_o1.png',
        config: [
          { unitId: 'ogru', field: 'file', value: 'units\\orc\\grunt\\grunt' },
          { unitId: 'okod', field: 'file', value: 'units\\orc\\KotoBeast\\KotoBeast' },
          { unitId: 'orai', field: 'file', value: 'units\\orc\\WolfRider\\WolfRider' },
          { unitId: 'oshm', field: 'file', value: 'units\\orc\\shaman\\shaman' },
          { unitId: 'owyv', field: 'file', value: 'units\\orc\\WyvernRider\\WyvernRider' },
          { unitId: 'ocat', field: 'file', value: 'units\\orc\\catapult\\catapult' },
          { unitId: 'opeo', field: 'file', value: 'units\\orc\\Peon\\Peon' },
          { unitId: 'ocat', field: 'modelScale', value: '1' },
          { unitId: 'ogru', field: 'modelScale:hd', value: '1' },
          { unitId: 'oshm', field: 'modelScale:hd', value: '0.97' },
        ]
      },
      {
        id: 'o_u2',
        name: '霜狼氏族',
        preview: 'cosu_o2.png',
        config: [
          { unitId: 'ogru', field: 'file', value: 'cos\\orc1\\grunt' },
          { unitId: 'okod', field: 'file', value: 'cos\\orc1\\KotoBeast' },
          { unitId: 'orai', field: 'file', value: 'cos\\orc1\\WolfRider' },
          { unitId: 'oshm', field: 'file', value: 'cos\\orc1\\shaman' },
          { unitId: 'owyv', field: 'file', value: 'cos\\orc1\\WyvernRider' },
          { unitId: 'ocat', field: 'file', value: 'cos\\orc1\\catapult.mdl' },
          { unitId: 'ocat', field: 'modelScale', value: '1.25' },
          { unitId: 'ogru', field: 'modelScale:hd', value: '1.05' },
          { unitId: 'oshm', field: 'modelScale:hd', value: '0.97' },
        ]
      },
      {
        id: 'o_u3',
        name: '混乱兽族',
        preview: 'cosu_o3.png',
        config: [
          { unitId: 'ogru', field: 'file', value: 'units\\demon\\chaosgrunt\\chaosgrunt.mdx' },
          { unitId: 'ogru', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNChaosGrunt.blp' },
          { unitId: 'okod', field: 'file', value: 'units\\demon\\chaoskotobeast\\chaoskotobeast.mdx' },
          { unitId: 'okod', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNChaosKotoBeast.blp' },
          { unitId: 'orai', field: 'file', value: 'units\\demon\\chaoswolfrider\\chaoswolfrider.mdx' },
          { unitId: 'orai', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNChaosWolfRider.blp' },
          { unitId: 'oshm', field: 'file', value: 'units\\demon\\chaoswarlock\\chaoswarlock.mdx' },
          { unitId: 'oshm', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNChaosWarlock.blp' },
          { unitId: 'opeo', field: 'file', value: 'units\\demon\\chaospeon\\chaospeon.mdx' },
          { unitId: 'opeo', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNChaosPeon.blp' },
          { unitId: 'oshm', field: 'modelScale:hd', value: '0.94' },
        ]
      }
    ],
    heroes: [
      {
        id: 'blademaster',
        unitId: 'Obla',
        name: '剑圣',
        icon: 'btnheroblademaster.png',
        skins: [
          {
            id: 'o5_1',
            name: '原版',
            preview: 'cosh_o7.png',
            config: [
              { field: 'file', value: 'units\\orc\\heroblademaster\\heroblademaster' },
              { field: 'Art', value: 'replaceabletextures\\commandbuttons\\btnheroblademaster.blp' },
              { field: 'unitSound', value: 'HeroBladeMaster' },
              { field: 'modelScale:hd', value: '1.06' }
            ]
          },
          {
            id: 'o5_2',
            name: '萨穆罗',
            preview: 'cosh_o6.png',
            config: [
              { field: 'file', value: 'Units\\Orc\\Samuro\\Samuro' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNSamuro.blp' },
              { field: 'unitSound', value: 'HeroBladeMaster' },
              { field: 'modelScale:hd', value: '1.08' }
            ]
          },
          {
            id: 'o5_3',
            name: '格罗姆',
            preview: 'cosh_o5.png',
            config: [
              { field: 'file', value: 'units\\orc\\Hellscream\\Hellscream' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNHellScream.blp' },
              { field: 'unitSound', value: 'Grom' },
              { field: 'modelScale:hd', value: '1.08' }
            ]
          },
          {
            id: 'o5_4',
            name: '混沌格罗姆',
            preview: 'cosh_o4.png',
            config: [
              { field: 'file', value: 'units\\demon\\ChaosHellscream\\ChaosHellscream' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNChaosGrom.blp' },
              { field: 'unitSound', value: 'Grom' },
              { field: 'modelScale:hd', value: '1.05' }
            ]
          },
          {
            id: 'o5_5',
            name: '混沌剑圣',
            preview: 'cosh_o3.png',
            config: [
              { field: 'file', value: 'units\\demon\\HeroChaosBladeMaster\\HeroChaosBladeMaster' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNChaosBlademaster.blp' },
              { field: 'unitSound', value: 'HeroBladeMaster' },
              { field: 'modelScale:hd', value: '1.08' }
            ]
          },
          {
            id: 'o5_6',
            name: '阿卡玛',
            preview: 'cosh_o2.png',
            config: [
              { field: 'file', value: 'cos\\DranaiAkama' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNDranaiAkama.blp' },
              { field: 'unitSound', value: 'Akama' },
              { field: 'modelScale:hd', value: '1.15' }
            ]
          },
          {
            id: 'o5_7',
            name: '卡加斯',
            preview: 'cosh_o15.png',
            config: [
              { field: 'file', value: 'cos\\kargath\\kargath_green' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\btnkargathgreen' },
              { field: 'unitSound', value: 'Grom' },
              { field: 'modelScale:hd', value: '1.15' }
            ]
          }
        ]
      },
      {
        id: 'farseer',
        unitId: 'Ofar',
        name: '先知',
        icon: 'btnherofarseer.png',
        skins: [
          {
            id: 'o6_1',
            name: '原版',
            preview: 'cosh_o14.png',
            config: [
              { field: 'file', value: 'units\\orc\\HeroFarSeer\\HeroFarSeer' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroFarseer.blp' },
              { field: 'unitSound', value: 'HeroFarSeer' },
              { field: 'modelScale:hd', value: '1.02' }
            ]
          },
          {
            id: 'o6_2',
            name: '萨尔',
            preview: 'cosh_o1.png',
            config: [
              { field: 'file', value: 'units\\orc\\Thrall\\Thrall' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNThrall.blp' },
              { field: 'unitSound', value: 'Thrall' },
              { field: 'modelScale:hd', value: '1.02' }
            ]
          },
          {
            id: 'o6_3',
            name: '德雷克塔尔',
            preview: 'cosh_o13.png',
            config: [
              { field: 'file', value: 'Units\\Orc\\DrekThar\\DrekThar' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNDrekThar.blp' },
              { field: 'unitSound', value: 'HeroFarSeer' },
              { field: 'modelScale:hd', value: '1.02' }
            ]
          },
          {
            id: 'o6_4',
            name: '古尔丹',
            preview: 'cosh_o12.png',
            config: [
              { field: 'file', value: 'units\\orc\\OrcWarlockGuldan\\OrcWarlockGuldan' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNGuldan.blp' },
              { field: 'unitSound', value: 'HeroFarSeer' },
              { field: 'modelScale:hd', value: '1.2' }
            ]
          },
          {
            id: 'o6_5',
            name: '部落勇士萨尔',
            config: [
              { field: 'file:hd', value: 'Units\\Orc\\ThrallChampion\\ThrallChampion' },
              { field: 'unitSound', value: 'Thrall' },
              { field: 'modelScale:hd', value: '1.02' }
            ]
          }
        ]
      },
      {
        id: 'taurenchieftain',
        unitId: 'Otch',
        name: '牛头人酋长',
        icon: 'btnherotaurenchieftain.png',
        skins: [
          {
            id: 'o7_1',
            name: '原版',
            preview: 'cosh_o8.png',
            config: [
              { field: 'file', value: 'units\\orc\\HeroTaurenChieftain\\HeroTaurenChieftain' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroTaurenChieftain.blp' },
              { field: 'unitSound', value: 'HeroTaurenChieftain' },
              { field: 'modelScale:hd', value: '1.05' }
            ]
          },
          {
            id: 'o7_2',
            name: '凯恩·血蹄',
            preview: 'cosh_o9.png',
            config: [
              { field: 'file', value: 'units\\orc\\HeroTaurenChieftainCIN\\HeroTaurenChieftainCIN' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNCairneBloodhoof.blp' },
              { field: 'unitSound', value: 'Cairne' },
              { field: 'modelScale:hd', value: '1.05' }
            ]
          }
        ]
      },
      {
        id: 'shadowhunter',
        unitId: 'Oshd',
        name: '暗影猎手',
        icon: 'btnshadowhunter.png',
        skins: [
          {
            id: 'o8_1',
            name: '原版',
            preview: 'cosh_o11.png',
            config: [
              { field: 'file', value: 'units\\orc\\HeroShadowHunter\\HeroShadowHunter' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNShadowHunter.blp' },
              { field: 'unitSound', value: 'HeroShadowHunter' },
              { field: 'modelScale:hd', value: '1.05' }
            ]
          },
          {
            id: 'o8_2',
            name: '罗坎',
            preview: 'cosh_o10.png',
            config: [
              { field: 'file', value: 'Units\\Orc\\Rokhan\\Rokhan' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNRokhan.blp' },
              { field: 'unitSound', value: 'Rokhan' },
              { field: 'modelScale:hd', value: '1.05' }
            ]
          },
          {
            id: 'o8_3',
            name: '沃金',
            preview: 'cosh_o16.png',
            config: [
              { field: 'file', value: 'units\\Orc\\VolJin\\VolJin' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNVoljin.blp' },
              { field: 'unitSound', value: 'WitchDoctor' },
              { field: 'modelScale:hd', value: '1.15' }
            ]
          }
        ]
      }
    ]
  },
  ud: {
    id: 'ud',
    name: '不死族',
    warbands: [
      {
        id: 'u_u1',
        name: '原版',
        preview: 'cosu_u1.png',
        config: [
          { unitId: 'uabo', field: 'file', value: 'units\\undead\\Abomination\\Abomination' },
          { unitId: 'uabo', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNAbomination.blp' },
          { unitId: 'uabo', field: 'modelScale:hd', value: '1.1' },
          { unitId: 'uban', field: 'file', value: 'units\\undead\\Banshee\\Banshee' },
          { unitId: 'uban', field: 'modelScale:hd', value: '0.95' },
          { unitId: 'ucry', field: 'file', value: 'units\\undead\\CryptFiend\\CryptFiend' },
          { unitId: 'ufro', field: 'file', value: 'units\\undead\\FrostWyrm\\FrostWyrm' },
          { unitId: 'ufro', field: 'modelScale:hd', value: '0.85' },
          { unitId: 'ugho', field: 'file', value: 'units\\undead\\Ghoul\\Ghoul' },
          { unitId: 'ugho', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNGhoul.blp' },
          { unitId: 'umtw', field: 'file', value: 'units\\undead\\MeatWagon\\MeatWagon' },
          { unitId: 'unec', field: 'file', value: 'units\\undead\\Necromancer\\Necromancer' },
          { unitId: 'unec', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNNecromancer.blp' },
          { unitId: 'unec', field: 'modelScale:hd', value: '0.95' },
          { unitId: 'uske', field: 'file', value: 'units\\undead\\Skeleton\\Skeleton' },
          { unitId: 'uske', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNSkeletonWarrior.blp' },
          { unitId: 'uske', field: 'unitSound', value: 'Skeleton' },
          { unitId: 'uskm', field: 'file', value: 'units\\undead\\SkeletonMage\\SkeletonMage' },
          { unitId: 'uskm', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNSkeletonMage.blp' },
          { unitId: 'uskm', field: 'unitSound', value: 'Skeleton' },
        ]
      },
      {
        id: 'u_u2',
        name: '诅咒教派',
        preview: 'cosu_u2.png',
        config: [
          { unitId: 'uabo', field: 'file', value: 'units\\other\\FleshGolem\\FleshGolem.mdl' },
          { unitId: 'uabo', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNFleshGolem.blp' },
          { unitId: 'uabo', field: 'modelScale:hd', value: '0.75' },
          { unitId: 'uban', field: 'file', value: 'cos\\ud1\\bansheewraith' },
          { unitId: 'uban', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNWraith.blp' },
          { unitId: 'uban', field: 'modelScale:hd', value: '0.77' },
          { unitId: 'ucry', field: 'file', value: 'cos\\ud1\\CryptFiend' },
          { unitId: 'ufro', field: 'file', value: 'units\\undead\\sapphironundead\\sapphironundead' },
          { unitId: 'ufro', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNSapphironUndead.blp' },
          { unitId: 'ufro', field: 'modelScale:hd', value: '0.65' },
          { unitId: 'unec', field: 'file', value: 'cos\\ud1\\revenantfrost' },
          { unitId: 'unec', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNFrostRevenant.blp' },
          { unitId: 'unec', field: 'modelScale:hd', value: '1.05' },
          { unitId: 'ugho', field: 'file', value: 'units\\undead\\Ghoul\\Ghoul' },
          { unitId: 'ugho', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNZombie.blp' },
          { unitId: 'uske', field: 'unitSound', value: 'Skeleton' },
          { unitId: 'uskm', field: 'unitSound', value: 'Skeleton' },
        ]
      },
      {
        id: 'u_u3',
        name: '僵尸战团',
        preview: 'cosu_u3.png',
        config: [
          { unitId: 'uabo', field: 'file', value: 'cos\\ud2\\1' },
          { unitId: 'uabo', field: 'modelScale:hd', value: '1.15' },
          { unitId: 'umtw', field: 'file', value: 'cos\\ud2\\2' },
          { unitId: 'ugho', field: 'file', value: 'cos\\ud2\\3' },
          { unitId: 'ugho', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNud2.blp' },
          { unitId: 'unec', field: 'file', value: 'units\\Undead\\Deceiver\\Deceiver' },
          { unitId: 'unec', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNDeceiver.blp' },
          { unitId: 'uske', field: 'file', value: 'units\\creeps\\Zombie\\Zombie' },
          { unitId: 'uske', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNZombie.blp' },
          { unitId: 'uske', field: 'unitSound', value: 'Zombie' },
          { unitId: 'uskm', field: 'file', value: 'units\\Creeps\\ZombieFemale\\ZombieFemale' },
          { unitId: 'uskm', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNZombieFemale.blp' },
          { unitId: 'uskm', field: 'unitSound', value: 'Zombie' },
        ]
      }
    ],
    heroes: [
      {
        id: 'deathknight',
        unitId: 'Udea',
        name: '死亡骑士',
        icon: 'btnherodeathknight.png',
        skins: [
          {
            id: 'u9_1',
            name: '原版',
            preview: 'cosh_u7.png',
            config: [
              { field: 'file:hd', value: 'Units\\Undead\\EvilArthas\\UndeadArthas' },
              { field: 'Art:hd', value: 'ReplaceableTextures\\CommandButtons\\BTNArthasEvil.blp' },
              { field: 'unitSound', value: 'HeroDeathKnight' },
              { field: 'modelScale:hd', value: '1.15' }
            ]
          },
          {
            id: 'u9_2',
            name: '巫妖王',
            preview: 'cosh_u8.png',
            config: [
              { field: 'file:hd', value: 'cos\\TheLichKing.mdx' },
              { field: 'Art:hd', value: 'ReplaceableTextures\\CommandButtons\\BTNTheLichKing.blp' },
              { field: 'unitSound', value: 'EvilArthas' },
              { field: 'modelScale:hd', value: '1.3' }
            ]
          },
          {
            id: 'u9_3',
            name: '黑锋骑士',
            preview: 'cosh_u6.png',
            config: [
              { field: 'file:hd', value: 'cos\\DeathKnightMounted\\Death_Knight_Mount' },
              { field: 'Art:hd', value: 'ReplaceableTextures\\CommandButtons\\BTNDeathknightMounted.dds' },
              { field: 'unitSound', value: 'HeroDeathKnight' },
              { field: 'modelScale:hd', value: '1.2' }
            ]
          },
          {
            id: 'u9_4',
            name: '堕落之王阿尔萨斯',
            config: [
              { field: 'file:hd', value: 'Units\\Undead\\FallenKingArthas\\FallenKingArthas' },
              { field: 'unitSound', value: 'EvilArthas' },
              { field: 'modelScale:hd', value: '1.15' }
            ]
          },
          {
            id: 'u9_5',
            name: '女死亡骑士',
            config: [
              { field: 'file:hd', value: 'Units\\Undead\\HeroFemaleDeathKnight\\HeroFemaleDeathKnight' },
              { field: 'unitSound', value: 'HeroDeathKnight' },
              { field: 'modelScale:hd', value: '1.15' }
            ]
          }
        ]
      },
      {
        id: 'lich',
        unitId: 'Ulic',
        name: '巫妖',
        icon: 'btnherolich.png',
        skins: [
          {
            id: 'u10_1',
            name: '原版',
            preview: 'cosh_u3.png',
            config: [
              { field: 'file', value: 'units\\undead\\HeroLich\\HeroLich' },
              { field: 'Art:hd', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroLich.blp' },
              { field: 'unitSound', value: 'HeroLich' },
              { field: 'modelScale:hd', value: '0.97' },
              { field: 'fileVerFlags', value: '2' }
            ]
          },
          {
            id: 'u10_2',
            name: '克尔苏加德',
            preview: 'cosh_u4.png',
            config: [
              { field: 'file', value: 'Units\\undead\\HeroLichCIN\\HeroLichCIN' },
              { field: 'Art:hd', value: 'ReplaceableTextures\\CommandButtons\\BTNLichVersion2.blp' },
              { field: 'unitSound', value: 'KelThuzadLich' },
              { field: 'modelScale:hd', value: '1.01' },
              { field: 'fileVerFlags', value: '2' }
            ]
          },
          {
            id: 'u10_3',
            name: '女妖希尔瓦娜斯',
            preview: 'cosh_u5.png',
            config: [
              { field: 'file', value: 'cos\\SylvanasBanshee.mdx' },
              { field: 'Art:hd', value: 'ReplaceableTextures\\CommandButtons\\BTNSylvanasGhost.blp' },
              { field: 'unitSound', value: 'EvilSylvanas' },
              { field: 'modelScale:hd', value: '1.2' },
              { field: 'fileVerFlags', value: '0' }
            ]
          }
        ]
      },
      {
        id: 'dreadlord',
        unitId: 'Udre',
        name: '恐惧魔王',
        icon: 'btnherodreadlord.png',
        skins: [
          {
            id: 'u11_1',
            name: '原版',
            preview: 'cosh_u15.png',
            config: [
              { field: 'file', value: 'units\\undead\\HeroDreadLord\\HeroDreadLord' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroDreadLord.blp' },
              { field: 'unitSound', value: 'HeroDreadLord' },
              { field: 'modelScale:hd', value: '1.15' }
            ]
          },
          {
            id: 'u11_2',
            name: '提康迪奥斯',
            preview: 'cosh_u14.png',
            config: [
              { field: 'file', value: 'units\\undead\\Tichondrius\\Tichondrius' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNTichondrius.blp' },
              { field: 'unitSound', value: 'Tichondrius' },
              { field: 'modelScale:hd', value: '1.08' }
            ]
          },
          {
            id: 'u11_3',
            name: '德赛洛克',
            preview: 'cosh_u13.png',
            config: [
              { field: 'file', value: 'Units\\Undead\\Detheroc\\Detheroc' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNDetheroc.blp' },
              { field: 'unitSound', value: 'HeroDreadLord' },
              { field: 'modelScale:hd', value: '1.06' }
            ]
          },
          {
            id: 'u11_4',
            name: '瓦里玛萨斯',
            preview: 'cosh_u12.png',
            config: [
              { field: 'file', value: 'Units\\Undead\\Varimathras\\Varimathras' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNVarimathras.blp' },
              { field: 'unitSound', value: 'Varimathras' },
              { field: 'modelScale:hd', value: '1.15' }
            ]
          },
          {
            id: 'u11_5',
            name: '巴纳扎尔',
            preview: 'cosh_u11.png',
            config: [
              { field: 'file', value: 'units\\Undead\\Balnazzar\\Balnazzar' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNBalnazzar.blp' },
              { field: 'unitSound', value: 'Varimathras' },
              { field: 'modelScale:hd', value: '1.05' }
            ]
          },
          {
            id: 'u11_6',
            name: '玛尔加尼斯',
            preview: 'cosh_u10.png',
            config: [
              { field: 'file', value: 'units\\Undead\\MalGanis\\MalGanis' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNMalGanis.blp' },
              { field: 'unitSound', value: 'Tichondrius' },
              { field: 'modelScale:hd', value: '1.15' }
            ]
          },
          {
            id: 'u11_7',
            name: '达尔坎',
            preview: 'cosh_u9.png',
            config: [
              { field: 'file', value: 'Units\\Undead\\Varimathras\\Varimathras' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNVarimathras.blp' },
              { field: 'unitSound', value: 'Tichondrius' },
              { field: 'modelScale:hd', value: '1.15' }
            ]
          }
        ]
      },
      {
        id: 'cryptlord',
        unitId: 'Ucrl',
        name: '地穴领主',
        icon: 'btnherocryptlord.png',
        skins: [
          {
            id: 'u12_1',
            name: '原版',
            preview: 'cosh_u1.png',
            config: [
              { field: 'file', value: 'units\\undead\\HeroCryptLord\\HeroCryptLord' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroCryptLord.blp' },
              { field: 'unitSound', value: 'HeroCryptLord' },
              { field: 'modelScale:hd', value: '1.04' }
            ]
          },
          {
            id: 'u12_2',
            name: '阿努巴拉克',
            preview: 'cosh_u2.png',
            config: [
              { field: 'file', value: 'units\\undead\\Anubarak\\Anubarak' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNAnubarak.blp' },
              { field: 'unitSound', value: 'HeroCryptLord' },
              { field: 'modelScale:hd', value: '1.04' }
            ]
          }
        ]
      }
    ]
  },
  ne: {
    id: 'ne',
    name: '暗夜精灵',
    warbands: [
      {
        id: 'n_u1',
        name: '原版',
        preview: 'cosu_n1.png',
        config: [
          { unitId: 'earc', field: 'file', value: 'units\\nightelf\\Archer\\Archer' },
          { unitId: 'ebal', field: 'file', value: 'units\\nightelf\\Ballista\\Ballista' },
          { unitId: 'esen', field: 'file', value: 'units\\nightelf\\Huntress\\Huntress' },
          { unitId: 'ehpr', field: 'file', value: 'units\\nightelf\\RiddenHippogryph\\RiddenHippogryph' },
          { unitId: 'ehip', field: 'file', value: 'units\\nightelf\\Hippogryph\\Hippogryph' },
          { unitId: 'emtg', field: 'file', value: 'units\\nightelf\\MountainGiant\\MountainGiant' },
          { unitId: 'emtg', field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNMountainGiant.blp' },
        ]
      },
      {
        id: 'n_u2',
        name: '哨兵精英',
        preview: 'cosu_n2.png',
        config: [
          { unitId: 'earc', field: 'file', value: 'units\\nightelf\\Shandris\\Shandris' },
          { unitId: 'ebal', field: 'file', value: 'cos\\ne1\\Ballista.mdx' },
          { unitId: 'esen', field: 'file', value: 'units\\NightElf\\Naisha\\Naisha' },
          { unitId: 'ehpr', field: 'file', value: 'cos\\ne1\\RiddenHippogryph' },
          { unitId: 'ehip', field: 'file', value: 'cos\\ne1\\Hippogryph' },
          { unitId: 'emtg', field: 'file', value: 'cos\\ne1\\MG' },
          { unitId: 'emtg', field: 'Art', value: 'replaceabletextures\\commandbuttons\\btnguardiangolem.dds' },
        ]
      }
    ],
    heroes: [
      {
        id: 'priestessofthemoon',
        unitId: 'Emoo',
        name: '月之女祭司',
        icon: 'btnheromoonpriestess.png',
        skins: [
          {
            id: 'n13_1',
            name: '原版',
            preview: 'cosh_n11.png',
            config: [
              { field: 'file', value: 'units\\nightelf\\HeroMoonPriestess\\HeroMoonPriestess' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNPriestessOfTheMoon.blp' },
              { field: 'unitSound', value: 'HeroMoonPriestess' },
              { field: 'modelScale:hd', value: '1.1' }
            ]
          },
          {
            id: 'n13_2',
            name: '泰兰德',
            preview: 'cosh_n9.png',
            config: [
              { field: 'file', value: 'Units\\NightElf\\Tyrande\\Tyrande' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNTyrande.blp' },
              { field: 'unitSound', value: 'Tyrande' },
              { field: 'modelScale:hd', value: '1.1' }
            ]
          },
          {
            id: 'n13_3',
            name: '泰兰德(不骑马)',
            preview: 'cosh_n8.png',
            config: [
              { field: 'file', value: 'cos\\TyrandeDismounted\\TyrandeMountless.mdx' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNTyrande.blp' },
              { field: 'unitSound', value: 'Tyrande' },
              { field: 'modelScale:hd', value: '1.1' }
            ]
          }
        ]
      },
      {
        id: 'keeperofthegrove',
        unitId: 'Ekee',
        name: '丛林守护者',
        icon: 'btnkeeperofthegrove.png',
        skins: [
          {
            id: 'n14_1',
            name: '原版',
            preview: 'cosh_n7.png',
            config: [
              { field: 'file', value: 'units\\nightelf\\HeroKeeperoftheGrove\\HeroKeeperoftheGrove' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNKeeperOfTheGrove.blp' },
              { field: 'unitSound', value: 'HeroKeeperoftheGrove' },
              { field: 'modelScale:hd', value: '1.06' }
            ]
          },
          {
            id: 'n14_2',
            name: '塞纳留斯',
            preview: 'cosh_n6.png',
            config: [
              { field: 'file', value: 'Units\\NightElf\\Cenarius\\Cenarius' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNCenarius.blp' },
              { field: 'unitSound', value: 'HeroKeeperoftheGrove' },
              { field: 'modelScale:hd', value: '0.9' }
            ]
          },
          {
            id: 'n14_3',
            name: '玛法里奥',
            preview: 'cosh_n5.png',
            config: [
              { field: 'file', value: 'units\\nightelf\\MalFurion\\MalFurion' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNFurion.blp' },
              { field: 'unitSound', value: 'Furion' },
              { field: 'modelScale:hd', value: '1.06' }
            ]
          },
          {
            id: 'n14_4',
            name: '翡翠梦魇塞纳留斯',
            config: [
              { field: 'file:hd', value: 'Units\\NightElf\\CenariusNightmare\\CenariusNightmare' },
              { field: 'unitSound', value: 'HeroKeeperOfTheGrove' },
              { field: 'modelScale:hd', value: '0.9' }
            ]
          }
        ]
      },
      {
        id: 'demonhunter',
        unitId: 'Edem',
        name: '恶魔猎手',
        icon: 'btnherodemonhunter.png',
        skins: [
          {
            id: 'n15_1',
            name: '原版',
            preview: 'cosh_n10.png',
            config: [
              { field: 'file:hd', value: 'Units\\NightElf\\Illidan\\Illidan' },
              { field: 'Art:hd', value: 'ReplaceableTextures\\CommandButtons\\BTNIllidan.blp' },
              { field: 'unitSound', value: 'HeroDemonHunter' },
              { field: 'modelScale:hd', value: '1.05' }
            ]
          },
          {
            id: 'n15_2',
            name: '伊利丹',
            preview: 'cosh_n1.png',
            config: [
              { field: 'file:hd', value: 'units\\nightelf\\EvilIllidan\\IllidanEvil' },
              { field: 'Art:hd', value: 'ReplaceableTextures\\CommandButtons\\BTNEvilIllidan.blp' },
              { field: 'unitSound', value: 'EvilIllidan' },
              { field: 'modelScale:hd', value: '1.12' }
            ]
          },
          {
            id: 'n15_4',
            name: '女恶魔猎手',
            config: [
              { field: 'file:hd', value: 'Units\\NightElf\\HeroFemaleDemonHunter\\HeroFemaleDemonHunter' },
              { field: 'unitSound', value: 'HeroDemonHunter' },
              { field: 'modelScale:hd', value: '1.05' }
            ]
          }
        ]
      },
      {
        id: 'warden',
        unitId: 'Ewar',
        name: '守望者',
        icon: 'btnherowarden.png',
        skins: [
          {
            id: 'n16_1',
            name: '原版',
            preview: 'cosh_n3.png',
            config: [
              { field: 'file', value: 'units\\nightelf\\herowarden\\herowarden' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroWarden.blp' },
              { field: 'unitSound', value: 'HeroWarden' },
              { field: 'modelScale:hd', value: '1.2' }
            ]
          },
          {
            id: 'n16_2',
            name: '玛维',
            preview: 'cosh_n2.png',
            config: [
              { field: 'file', value: 'units\\nightelf\\Maiev\\Maiev' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNWarden2.blp' },
              { field: 'unitSound', value: 'Maiev' },
              { field: 'modelScale:hd', value: '1.2' }
            ]
          },
          {
            id: 'n16_3',
            name: '影之歌',
            preview: 'cosh_n4.png',
            config: [
              { field: 'file', value: 'cos\\mv\\Maiev' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNmv.blp' },
              { field: 'unitSound', value: 'Maiev' },
              { field: 'modelScale:hd', value: '1.2' }
            ]
          }
        ]
      }
    ]
  },
  neutral: {
    id: 'neutral',
    name: '中立',
    warbands: [],
    heroes: [
      {
        id: 'beastmaster',
        unitId: 'Nbst',
        name: '兽王',
        icon: 'p01.png',
        skins: [
          {
            id: 't17_1',
            name: '原版',
            preview: 'cosh_t4.png',
            config: [
              { field: 'file', value: 'Units\\Creeps\\Beastmaster\\Beastmaster' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNBeastMaster.blp' },
              { field: 'unitSound', value: 'HeroBeastMaster' },
              { field: 'modelScale:hd', value: '1.05' }
            ]
          },
          {
            id: 't17_2',
            name: '雷克萨',
            preview: 'cosh_t3.png',
            config: [
              { field: 'file', value: 'Units\\Other\\Rexxar\\Rexxar' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNRexxar.blp' },
              { field: 'unitSound', value: 'Rexxar' },
              { field: 'modelScale:hd', value: '1.1' }
            ]
          }
        ]
      },
      {
        id: 'darkranger',
        unitId: 'Nbrn',
        name: '黑暗游侠',
        icon: 'p02.png',
        skins: [
          {
            id: 't18_1',
            name: '原版',
            preview: 'cosh_t13.png',
            config: [
              { field: 'file', value: 'Units\\Creeps\\BansheeRanger\\BansheeRanger' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNBansheeRanger.blp' },
              { field: 'unitSound', value: 'DarkRanger' },
              { field: 'modelScale:hd', value: '1.15' }
            ]
          },
          {
            id: 't18_2',
            name: '希尔瓦娜斯(邪恶)',
            preview: 'cosh_t14.png',
            config: [
              { field: 'file', value: 'Units\\Undead\\EvilSylvanas\\EvilSylvanas' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNSylvanas.blp' },
              { field: 'unitSound', value: 'EvilSylvanas' },
              { field: 'modelScale:hd', value: '1.2' }
            ]
          },
          {
            id: 't18_3',
            name: '希尔瓦娜斯(游侠)',
            preview: 'cosh_t12.png',
            config: [
              { field: 'file', value: 'units\\creeps\\SylvanusWindrunner\\SylvanusWindrunner' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNSylvanusWindrunner.blp' },
              { field: 'unitSound', value: 'Sylvanus' },
              { field: 'modelScale:hd', value: '1.2' }
            ]
          },
          {
            id: 't18_4',
            name: '珍娜拉·蒂姆斯普林',
            preview: 'cosh_t11.png',
            config: [
              { field: 'file', value: 'units\\Other\\JennallaDeemspring\\JennallaDeemspring' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNJennallaDeemspring.blp' },
              { field: 'unitSound', value: 'Sylvanus' },
              { field: 'modelScale:hd', value: '1.2' }
            ]
          }
        ]
      },
      {
        id: 'nagaseawitch',
        unitId: 'Nngs',
        name: '娜迦海妖',
        icon: 'btnnagaseawitch.png',
        skins: [
          {
            id: 't19_1',
            name: '原版',
            preview: 'cosh_t18.png',
            config: [
              { field: 'file', value: 'units\\naga\\HeroNagaSeawitch\\HeroNagaSeawitch' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNNagaSeaWitch.blp' },
              { field: 'unitSound', value: 'SeaWitch' },
              { field: 'modelScale:hd', value: '1.05' }
            ]
          },
          {
            id: 't19_2',
            name: '瓦丝琪',
            preview: 'cosh_t17.png',
            config: [
              { field: 'file', value: 'units\\naga\\LadyVashj\\LadyVashj' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNLadyVashj.blp' },
              { field: 'unitSound', value: 'SeaWitch' },
              { field: 'modelScale:hd', value: '1.05' }
            ]
          }
        ]
      },
      {
        id: 'goblin-alchemist',
        unitId: 'Nalc',
        name: '炼金术士',
        icon: 'p15.png',
        skins: [
          {
            id: 't20_1',
            name: '原版',
            preview: 'cosh_t10.png',
            config: [
              { field: 'file', value: 'Units\\Creeps\\HeroGoblinAlchemist\\HeroGoblinAlchemist' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroAlchemist.blp' },
              { field: 'Art:hd', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroAlchemist.blp' },
              { field: 'unitSound', value: 'HeroGoblinAlchemist' }
            ]
          },
          {
            id: 't20_2',
            name: '重制版',
            preview: 'cosh_t9.png',
            config: [
              { field: 'file', value: 'cos\\GAOrigin\\HeroGoblinAlchemist' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroAlchemist.blp' },
              { field: 'Art:hd', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroAlchemist.blp' },
              { field: 'unitSound', value: 'HeroGoblinAlchemist' }
            ]
          }
        ]
      },
      {
        id: 'pandarenbrewmaster',
        unitId: 'Npbm',
        name: '熊猫酒仙',
        icon: 'p056.png',
        skins: [
          {
            id: 't21_1',
            name: '原版',
            preview: 'cosh_t20.png',
            config: [
              { field: 'file', value: 'Units\\Creeps\\PandarenBrewmaster\\PandarenBrewmaster' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNPandarenBrewmaster.blp' },
              { field: 'unitSound', value: 'PandarenBrewmaster' },
              { field: 'modelScale:hd', value: '1.2' }
            ]
          },
          {
            id: 't21_2',
            name: '老陈',
            preview: 'cosh_t19.png',
            config: [
              { field: 'file', value: 'Units\\Creeps\\ChenStormstout\\ChenStormstout' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNChenStormstout.blp' },
              { field: 'unitSound', value: 'PandarenBrewmaster' },
              { field: 'modelScale:hd', value: '1.17' }
            ]
          }
        ]
      },
      {
        id: 'firelord',
        unitId: 'Nfir',
        name: '火焰领主',
        icon: 'p055.png',
        skins: [
          {
            id: 't22_1',
            name: '原版',
            preview: 'cosh_t16.png',
            config: [
              { field: 'file', value: 'units\\Creeps\\HeroFlameLord\\HeroFlameLord' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroAvatarOfFlame.blp' },
              { field: 'Art:hd', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroAvatarOfFlame.blp' },
              { field: 'unitSound', value: 'HeroFlameLord' }
            ]
          },
          {
            id: 't22_2',
            name: '拉格纳罗斯',
            preview: 'cosh_t15.png',
            config: [
              { field: 'file', value: 'cos/volcanus.mdx' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroAvatarOfFlame.blp' },
              { field: 'Art:hd', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroAvatarOfFlame.blp' },
              { field: 'unitSound', value: 'HeroFlameLord' }
            ]
          }
        ]
      },
      {
        id: 'goblin-tinker',
        unitId: 'Ntin',
        name: '修补匠',
        icon: 'p054.png',
        skins: [
          {
            id: 't23_1',
            name: '原版',
            preview: 'cosh_t2.png',
            config: [
              { field: 'file', value: 'Units\\Creeps\\HeroTinker\\HeroTinker' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNHeroTinker.blp' },
              { field: 'unitSound', value: 'HeroTinker' },
              { field: 'modelScale:hd', value: '1.15' }
            ]
          },
          {
            id: 't23_2',
            name: '加兹鲁维',
            preview: 'cosh_t1.png',
            config: [
              { field: 'file', value: 'Units\\Creeps\\HeroTinkerGazlowe\\HeroTinkerGazlowe' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNEngineerGazlowe.blp' },
              { field: 'unitSound', value: 'HeroTinker' },
              { field: 'modelScale:hd', value: '1.12' }
            ]
          }
        ]
      },
      {
        id: 'pitlord',
        unitId: 'Nplh',
        name: '深渊领主',
        icon: 'p053.png',
        skins: [
          {
            id: 't24_1',
            name: '原版',
            preview: 'cosh_t8.png',
            config: [
              { field: 'file', value: 'units\\demon\\HeroPitLord\\HeroPitLord' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNPitLord.blp' },
              { field: 'unitSound', value: 'HeroPitLord' },
              { field: 'modelScale:hd', value: '1.05' }
            ]
          },
          {
            id: 't24_2',
            name: '玛瑟里顿',
            preview: 'cosh_t7.png',
            config: [
              { field: 'file', value: 'Units\\Demon\\Magtheridon\\Magtheridon' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNMagtheridon.blp' },
              { field: 'unitSound', value: 'HeroPitLord' },
              { field: 'modelScale:hd', value: '1.1' }
            ]
          },
          {
            id: 't24_3',
            name: '阿兹加洛',
            preview: 'cosh_t5.png',
            config: [
              { field: 'file', value: 'units\\demon\\PitLord\\PitLord' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNAzgalor.blp' },
              { field: 'unitSound', value: 'PitLord' },
              { field: 'modelScale:hd', value: '1.06' }
            ]
          },
          {
            id: 't24_4',
            name: '玛诺洛斯',
            preview: 'cosh_t6.png',
            config: [
              { field: 'file', value: 'units\\demon\\Mannoroth\\Mannoroth' },
              { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNMannoroth.blp' },
              { field: 'unitSound', value: 'HeroPitLord' },
              { field: 'modelScale:hd', value: '1.05' }
            ]
          }
        ]
      },
      {
        id: 'forsakenpaladin',
        unitId: 'Npal',
        name: '被遗忘的圣骑士',
        icon: 'skin-icon-npal.png',
        // Warcraft 3.0 tavern hero. Each art set resolves this path in its own
        // CASC layer; no campaign paladin or HD-only alternate is substituted.
        skins: [{
          id: 't25_1',
          name: '原版',
          preview: 'skin-icon-npal.png',
          config: [
            { field: 'file', value: 'Units\\Creeps\\HeroForsakenPaladin\\HeroForsakenPaladin' },
            { field: 'Art', value: 'ReplaceableTextures\\CommandButtons\\BTNForsakenPaladin.blp' },
            { field: 'unitSound', value: 'HeroForsakenPaladin' },
            { field: 'modelScale:sd', value: '1.2' },
            { field: 'modelScale:hd', value: '1.2' },
          ],
        }],
      }
    ]
  }
};
