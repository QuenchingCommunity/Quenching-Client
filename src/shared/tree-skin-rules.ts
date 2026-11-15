interface TreeSkinWriter {
    write(section: string, key: string, value: string): void;
}

// 对象皮肤和文件完整性检查共享这些路径。图集前缀不包含用途后缀。
export const D18_TREE_ASSETS = [
    { id: 'BTtw', model: 'BarrensTree/BarrensTree', texture: 'BarrensTree/QuenchingBarrensTree', count: 10 },
    { id: 'ATtc', model: 'AshenCanopyTree/AshenCanopyTree', texture: 'AshenvaleTree/QuenchingAshenCanopyTree', count: 3 },
    { id: 'CTtc', model: 'FelwoodCanopyTree/FelwoodCanopyTree', texture: 'AshenvaleTree/QuenchingFelwoodCanopyTree', count: 3 },
    { id: 'BTtc', model: 'BarrensCanopyTree/BarrensCanopyTree', texture: 'BarrensTree/QuenchingBarrensCanopyTree', count: 3 },
] as const;

// 四种城市树墙共用一组 D16 圆冠模型，游戏以 Replaceable ID 31 选择对应图集。
export const D16_CITYSCAPE_MODEL = 'Doodads/que/d16/Citytree';
export const D16_CITYSCAPE_TEXTURE = 'ReplaceableTextures/tree/t16/CityscapeTree/QuenchingCityscapeTree';
export const D16_CITYSCAPE_COUNT = 3;
export const D16_CITYSCAPE_SEASONS = { YTct: '', YTwt: 'w', YTft: 'a' } as const;
export const D16_CITYSCAPE_SNOW = 'Snow';
export type InstalledCityscape = 'seasonal' | 'snow';

interface InstalledTreeAssets {
    d18?: boolean;
    cityscape?: InstalledCityscape;
}

/** 应用指定树木预设。调用方只将本地安装齐全的可选资源组标记为可用。 */
export function applyTreeSkinRules(mode: string, handler: TreeSkinWriter, installed: InstalledTreeAssets = {}): boolean {
    switch (mode) {
        case 'tall': applyTo20(handler); return true;
        case 'short': applyTo20Short(handler); return true;
        case 'v18': applyTo18(handler, installed.d18 === true, installed.cityscape === 'snow'); return true;
        case 'v16': applyTo16(handler, installed.cityscape); return true;
        case 'retro': applyTo00(handler); return true;
        default: return false;
    }
}

function applyTo20(handler: TreeSkinWriter) {
    handler.write("ATtr", "texFile", "ReplaceableTextures/tree/t20/AshenvaleTree/AshenTree");
    handler.write("ATtr", "file", "Doodads/que/d20/AshenTree/AshenTree");
    handler.write("BTtw", "texFile", "ReplaceableTextures/tree/t20/BarrensTree/BarrensTree");
    handler.write("CTtr", "texFile", "ReplaceableTextures/tree/t20/AshenvaleTree/FelwoodTree");
    handler.write("CTtr", "file", "Doodads/que/d20/AshenTree/AshenTree");
    handler.write("FTtw", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronFallTree");
    handler.write("FTtw", "file", "Doodads/que/d20/LordaeronTree/LordaeronTree");
    handler.write("LTlt", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronSummerTree");
    handler.write("LTlt", "file", "Doodads/que/d20/LordaeronTree/LordaeronTree");
    handler.write("WTtw", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronWinterTree");
    handler.write("WTtw", "file", "Doodads/que/d20/LordaeronTree/LordaeronTree");
    handler.write("WTst", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronSnowTree");
    handler.write("WTst", "file", "Doodads/que/d20/LordaeronTree/LordaeronTree");
    handler.write("YTct", "texFile", "ReplaceableTextures/tree/tc/citytree/cityscapetree");
    handler.write("YTct", "file", "Doodads/que/d20/Citytree");
    handler.write("YTwt", "texFile", "ReplaceableTextures/tree/tc/citytree/cityscapetreew");
    handler.write("YTwt", "file", "Doodads/que/d20/Citytree");
    handler.write("YTft", "texFile", "ReplaceableTextures/tree/tc/citytree/cityscapetreea");
    handler.write("YTft", "file", "Doodads/que/d20/Citytree");
    handler.write("VTlt", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/lordaeronvillagetree");
    handler.write("VTlt", "file", "Doodads/que/d20/LordaeronTree/LordaeronTree");
    handler.write("ATt1", "texFile", "ReplaceableTextures/tree/t20/AshenvaleTree/AshenTree");
    handler.write("ATtc", "texFile", "ReplaceableTextures/tree/t20/AshenvaleTree/AshenCanopyTree");
    handler.write("JTct", "texFile", "ReplaceableTextures/tree/t20/lordaerontree/lordaeronsummertree");
    handler.write("JTct", "file", "Doodads/que/d20/lordaerontree/lordaerontree");
    handler.write("JTtw", "texFile", "ReplaceableTextures/tree/t20/lordaerontree/lordaeronsummertree");
    handler.write("JTtw", "file", "Doodads/que/d20/LordaeronTree/LordaeronTree");
    handler.write("BTtc", "texFile", "ReplaceableTextures/tree/t20/BarrensTree/BarrensTree");
    handler.write("CTtc", "texFile", "ReplaceableTextures/tree/t20/AshenvaleTree/felwoodcanopytree");
    handler.write("LFpt", "file", "Doodads/que/d20/LordaeronTree/LordaeronTree");
    handler.write("LFpt", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronFallTree");
    handler.write("Yts1", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronSummerTree");
    handler.write("Yts1", "texFile:hd", "ReplaceableTextures/tree/tc/SilvermoonTree/SilverMoonTree");
    handler.write("Yts2", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronSummerTree");
    handler.write("Yts3", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronSummerTree");
    handler.write("STlt", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronSummerTree");
    handler.write("STlt", "file", "Doodads/que/d20/LordaeronTree/LordaeronTree");
    handler.write("ZTtw", "texFile", "ReplaceableTextures/tree/tc/RuinsTree/RuinsTree");
    handler.write("ZTtc", "texFile", "ReplaceableTextures/tree/tc/RuinsTree/RuinsTree");
}

function applyTo20Short(handler: TreeSkinWriter) {
    handler.write("ATtr", "texFile", "ReplaceableTextures/tree/t20/AshenvaleTree/AshenTree");
    handler.write("ATtr", "file", "Doodads/que/d20/AshenTree/AshenTree");
    handler.write("BTtw", "texFile", "ReplaceableTextures/tree/t20/BarrensTree/BarrensTree");
    handler.write("CTtr", "texFile", "ReplaceableTextures/tree/t20/AshenvaleTree/FelwoodTree");
    handler.write("CTtr", "file", "Doodads/que/d20/AshenTree/AshenTree");
    handler.write("FTtw", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronFallTree");
    handler.write("FTtw", "file", "Doodads/que/d20/lordaerontree-short/LordaeronTree");
    handler.write("LTlt", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronSummerTree");
    handler.write("LTlt", "file", "Doodads/que/d20/lordaerontree-short/LordaeronTree");
    handler.write("WTtw", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronWinterTree");
    handler.write("WTtw", "file", "Doodads/que/d20/lordaerontree-short/LordaeronTree");
    handler.write("WTst", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronSnowTree");
    handler.write("WTst", "file", "Doodads/que/d20/lordaerontree-short/LordaeronTree");
    handler.write("YTct", "texFile", "ReplaceableTextures/tree/tc/citytree/cityscapetree");
    handler.write("YTct", "file", "Doodads/que/d20/Citytree");
    handler.write("YTwt", "texFile", "ReplaceableTextures/tree/tc/citytree/cityscapetreew");
    handler.write("YTwt", "file", "Doodads/que/d20/Citytree");
    handler.write("YTft", "texFile", "ReplaceableTextures/tree/tc/citytree/cityscapetreea");
    handler.write("YTft", "file", "Doodads/que/d20/Citytree");
    handler.write("VTlt", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/lordaeronvillagetree");
    handler.write("VTlt", "file", "Doodads/que/d20/lordaerontree-short/LordaeronTree");
    handler.write("ATt1", "texFile", "ReplaceableTextures/tree/t20/AshenvaleTree/AshenTree");
    handler.write("ATtc", "texFile", "ReplaceableTextures/tree/t20/AshenvaleTree/AshenCanopyTree");
    handler.write("JTct", "texFile", "ReplaceableTextures/tree/t20/lordaerontree/lordaeronsummertree");
    handler.write("JTct", "file", "Doodads/que/d20/lordaerontree-short/lordaerontree");
    handler.write("JTtw", "texFile", "ReplaceableTextures/tree/t20/lordaerontree/lordaeronsummertree");
    handler.write("JTtw", "file", "Doodads/que/d20/lordaerontree-short/LordaeronTree");
    handler.write("BTtc", "texFile", "ReplaceableTextures/tree/t20/BarrensTree/BarrensTree");
    handler.write("CTtc", "texFile", "ReplaceableTextures/tree/t20/AshenvaleTree/felwoodcanopytree");
    handler.write("LFpt", "file", "Doodads/que/d20/lordaerontree-short/LordaeronTree");
    handler.write("LFpt", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronFallTree");
    handler.write("Yts1", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronSummerTree");
    handler.write("Yts1", "texFile:hd", "ReplaceableTextures/tree/tc/SilvermoonTree/SilverMoonTree");
    handler.write("Yts2", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronSummerTree");
    handler.write("Yts3", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronSummerTree");
    handler.write("STlt", "texFile", "ReplaceableTextures/tree/t20/LordaeronTree/LordaeronSummerTree");
    handler.write("STlt", "file", "Doodads/que/d20/lordaerontree-short/LordaeronTree");
    handler.write("ZTtw", "texFile", "ReplaceableTextures/tree/tc/RuinsTree/RuinsTree");
    handler.write("ZTtc", "texFile", "ReplaceableTextures/tree/tc/RuinsTree/RuinsTree");
}

/** 应用 T18 路由，四套 Cityscape 图集齐全时共用 D16 圆冠树。 */
function applyTo18(handler: TreeSkinWriter, hasD18Trees: boolean, hasCityscapeSnow: boolean) {
    handler.write("ATtr", "texFile", "ReplaceableTextures/tree/t18/AshenvaleTree/QuenchingAshenTree");
    handler.write("ATtr", "file", "Doodads/que/d18/AshenTree/AshenTree");
    handler.write("ATtr", "numVar", "9");
    handler.write("BTtw", "texFile", "ReplaceableTextures/tree/t18/BarrensTree/BarrensTree");
    handler.write("CTtr", "texFile", "ReplaceableTextures/tree/t18/AshenvaleTree/QuenchingFelwoodTree");
    handler.write("CTtr", "file", "Doodads/que/d18/AshenTree/AshenTree");
    handler.write("CTtr", "numVar", "9");
    handler.write("FTtw", "texFile", "ReplaceableTextures/tree/t18/LordaeronTree/LordaeronFallTree");
    handler.write("FTtw", "file", "Doodads/que/d18/LordaeronTree/LordaeronTree");
    handler.write("LTlt", "texFile", "ReplaceableTextures/tree/t18/LordaeronTree/LordaeronSummerTree");
    handler.write("LTlt", "file", "Doodads/que/d18/LordaeronTree/LordaeronTree");
    handler.write("WTtw", "texFile", "ReplaceableTextures/tree/t18/LordaeronTree/LordaeronWinterTree");
    handler.write("WTtw", "file", "Doodads/que/d18/LordaeronTree/LordaeronTree");
    handler.write("WTst", "texFile", "ReplaceableTextures/tree/t18/LordaeronTree/LordaeronSnowTree");
    handler.write("WTst", "file", "Doodads/que/d18/LordaeronTree/LordaeronTree");
    if (hasCityscapeSnow) {
        applyD16Cityscape(handler, true);
    } else {
        // 旧资源包继续让城市三季使用原 T18 模型，落雪城市树从原版皮肤表读取。
        for (const [id, suffix] of Object.entries(D16_CITYSCAPE_SEASONS)) {
            handler.write(id, "texFile", `ReplaceableTextures/tree/tc/citytree/cityscapetree${suffix}`);
            handler.write(id, "file", "Doodads/que/d18/Citytree");
        }
    }
    handler.write("VTlt", "texFile", "ReplaceableTextures/tree/t18/LordaeronTree/lordaeronvillagetree");
    handler.write("VTlt", "file", "Doodads/que/d18/LordaeronTree/LordaeronTree");
    handler.write("ATt1", "texFile", "ReplaceableTextures/tree/t18/AshenvaleTree/AshenTree");
    handler.write("ATtc", "texFile", "ReplaceableTextures/tree/t18/AshenvaleTree/AshenCanopyTree");
    handler.write("JTct", "texFile", "ReplaceableTextures/tree/t18/lordaerontree/lordaeronsummertree");
    handler.write("JTct", "file", "Doodads/que/d18/lordaerontree/lordaerontree");
    handler.write("JTtw", "texFile", "ReplaceableTextures/tree/t18/lordaerontree/lordaeronsummertree");
    handler.write("JTtw", "file", "Doodads/que/d18/LordaeronTree/LordaeronTree");
    handler.write("BTtc", "texFile", "ReplaceableTextures/tree/t18/BarrensTree/BarrensTree");
    handler.write("CTtc", "texFile", "ReplaceableTextures/tree/t18/AshenvaleTree/QuenchingFelwoodCanopyTree");
    handler.write("LFpt", "file", "Doodads/que/d18/LordaeronTree/LordaeronTree");
    handler.write("LFpt", "texFile", "ReplaceableTextures/tree/t18/LordaeronTree/LordaeronFallTree");
    handler.write("Yts1", "texFile", "ReplaceableTextures/tree/t18/LordaeronTree/LordaeronSummerTree");
    handler.write("Yts1", "texFile:hd", "ReplaceableTextures/tree/tc/SilvermoonTree/SilverMoonTree");
    handler.write("Yts2", "texFile", "ReplaceableTextures/tree/t18/LordaeronTree/LordaeronSummerTree");
    handler.write("Yts3", "texFile", "ReplaceableTextures/tree/t18/LordaeronTree/LordaeronSummerTree");
    handler.write("STlt", "texFile", "ReplaceableTextures/tree/t18/LordaeronTree/LordaeronSummerTree");
    handler.write("STlt", "file", "Doodads/que/d18/LordaeronTree/LordaeronTree");
    handler.write("ZTtw", "texFile", "ReplaceableTextures/tree/tc/RuinsTree/RuinsTree");
    handler.write("ZTtc", "texFile", "ReplaceableTextures/tree/tc/RuinsTree/RuinsTree");
    handler.write("Yts1", "texFile:hd", "ReplaceableTextures/tree/tc/SilverMoonTree/SilverMoonTree");
    handler.write("Yts2", "texFile:hd", "ReplaceableTextures/tree/tc/SilverMoonTree/SilverMoonTree");
    handler.write("Yts3", "texFile:hd", "ReplaceableTextures/tree/tc/SilverMoonTree/SilverMoonTree");

    for (const { id, model, texture, count } of hasD18Trees ? D18_TREE_ASSETS : []) {
        const file = `Doodads/que/d18/${model}`;
        handler.write(id, "texFile", `ReplaceableTextures/tree/t18/${texture}`);
        handler.write(id, "file", file);
        handler.write(id, "numVar", String(count));
        // BTtc 的原版 HD 字段指向单个无编号模型，需同步成新的三个编号变体。
        if (id === 'BTtc') {
            handler.write(id, "file:hd", file);
            handler.write(id, "numVar:hd", String(count));
        }
    }
}

/** 把已安装的独立季节图集和对应模型写进 Cityscape 树墙选择器。 */
function applyD16Cityscape(handler: TreeSkinWriter, includeSnow: boolean) {
    const seasons = includeSnow ? { ...D16_CITYSCAPE_SEASONS, YTst: D16_CITYSCAPE_SNOW } : D16_CITYSCAPE_SEASONS;
    for (const [id, suffix] of Object.entries(seasons)) {
        handler.write(id, "texFile", D16_CITYSCAPE_TEXTURE + suffix);
        handler.write(id, "file", D16_CITYSCAPE_MODEL);
        handler.write(id, "numVar", String(D16_CITYSCAPE_COUNT));
    }
}

/** 在 D16 预设中按安装状态选择独立的 Cityscape 图集及变体数量。 */
function applyTo16(handler: TreeSkinWriter, cityscape?: InstalledCityscape) {
    handler.write("ATtr", "texFile", "ReplaceableTextures/tree/t16/AshenvaleTree/AshenTree");
    handler.write("BTtw", "texFile", "ReplaceableTextures/tree/t16/BarrensTree/BarrensTree");
    handler.write("CTtr", "texFile", "ReplaceableTextures/tree/t16/AshenvaleTree/FelwoodTree");
    handler.write("FTtw", "texFile", "ReplaceableTextures/tree/t16/LordaeronTree/LordaeronFallTree");
    handler.write("FTtw", "file", "Doodads/que/d16/LordaeronTree/LordaeronTree");
    handler.write("LTlt", "texFile", "ReplaceableTextures/tree/t16/LordaeronTree/LordaeronSummerTree");
    handler.write("LTlt", "file", "Doodads/que/d16/LordaeronTree/LordaeronTree");
    handler.write("WTtw", "texFile", "ReplaceableTextures/tree/t16/LordaeronTree/LordaeronWinterTree");
    handler.write("WTtw", "file", "Doodads/que/d16/LordaeronTree/LordaeronTree");
    handler.write("WTst", "texFile", "ReplaceableTextures/tree/t16/LordaeronTree/LordaeronSnowTree");
    handler.write("WTst", "file", "Doodads/que/d16/LordaeronTree/LordaeronTree");
    if (cityscape) {
        applyD16Cityscape(handler, cityscape === 'snow');
    } else {
        for (const [id, suffix] of Object.entries(D16_CITYSCAPE_SEASONS)) {
            handler.write(id, "texFile", `ReplaceableTextures/tree/tc/citytree/cityscapetree${suffix}`);
            handler.write(id, "file", D16_CITYSCAPE_MODEL);
        }
    }
    handler.write("VTlt", "texFile", "ReplaceableTextures/tree/t16/LordaeronTree/lordaeronvillagetree");
    handler.write("VTlt", "file", "Doodads/que/d16/LordaeronTree/LordaeronTree");
    handler.write("ATt1", "texFile", "ReplaceableTextures/tree/t16/AshenvaleTree/AshenTree");
    handler.write("ATtc", "texFile", "ReplaceableTextures/tree/t16/AshenvaleTree/AshenCanopyTree");
    handler.write("JTct", "texFile", "ReplaceableTextures/tree/t16/lordaerontree/lordaeronsummertree");
    handler.write("JTct", "file", "Doodads/que/d16/lordaerontree/lordaerontree");
    handler.write("JTtw", "texFile", "ReplaceableTextures/tree/t16/lordaerontree/lordaeronsummertree");
    handler.write("JTtw", "file", "Doodads/que/d16/LordaeronTree/LordaeronTree");
    handler.write("BTtc", "texFile", "ReplaceableTextures/tree/t16/BarrensTree/BarrensTree");
    handler.write("CTtc", "texFile", "ReplaceableTextures/tree/t16/AshenvaleTree/FelwoodCanopyTree");
    handler.write("LFpt", "file", "Doodads/que/d16/LordaeronTree/LordaeronTree");
    handler.write("LFpt", "texFile", "ReplaceableTextures/tree/t16/LordaeronTree/LordaeronFallTree");
    handler.write("Yts1", "texFile", "ReplaceableTextures/tree/t16/LordaeronTree/LordaeronSummerTree");
    handler.write("Yts1", "texFile:hd", "ReplaceableTextures/tree/tc/SilvermoonTree/SilverMoonTree");
    handler.write("Yts2", "texFile", "ReplaceableTextures/tree/t16/LordaeronTree/LordaeronSummerTree");
    handler.write("Yts3", "texFile", "ReplaceableTextures/tree/t16/LordaeronTree/LordaeronSummerTree");
    handler.write("STlt", "texFile", "ReplaceableTextures/tree/t16/LordaeronTree/LordaeronSummerTree");
    handler.write("STlt", "file", "Doodads/que/d16/LordaeronTree/LordaeronTree");
    handler.write("ZTtw", "texFile", "ReplaceableTextures/tree/tc/RuinsTree/RuinsTree");
    handler.write("ZTtc", "texFile", "ReplaceableTextures/tree/tc/RuinsTree/RuinsTree");
    handler.write("Yts1", "texFile:hd", "ReplaceableTextures/tree/tc/SilverMoonTree/SilverMoonTree");
    handler.write("Yts2", "texFile:hd", "ReplaceableTextures/tree/tc/SilverMoonTree/SilverMoonTree");
    handler.write("Yts3", "texFile:hd", "ReplaceableTextures/tree/tc/SilverMoonTree/SilverMoonTree");
}

function applyTo00(handler: TreeSkinWriter) {
    handler.write("ATtr", "texFile", "ReplaceableTextures/tree/t00/AshenvaleTree/AshenTree");
    handler.write("FTtw", "texFile", "ReplaceableTextures/tree/t00/LordaeronTree/LordaeronFallTree");
    handler.write("LTlt", "texFile", "ReplaceableTextures/tree/t00/LordaeronTree/LordaeronSummerTree");
    handler.write("WTtw", "texFile", "ReplaceableTextures/tree/t00/LordaeronTree/LordaeronWinterTree");
    handler.write("WTst", "texFile", "ReplaceableTextures/tree/t00/LordaeronTree/LordaeronSnowTree");
    handler.write("VTlt", "texFile", "ReplaceableTextures/tree/t00/LordaeronTree/lordaeronvillagetree");
    handler.write("ATt1", "texFile", "ReplaceableTextures/tree/t00/AshenvaleTree/AshenTree");
    handler.write("ATtc", "texFile", "ReplaceableTextures/tree/t00/AshenvaleTree/AshenCanopyTree");
    handler.write("JTct", "texFile", "ReplaceableTextures/tree/t00/lordaerontree/DalaranRuinsTree");
    handler.write("JTtw", "texFile", "ReplaceableTextures/tree/t00/lordaerontree/DalaranRuinsTree");
    handler.write("LFpt", "texFile", "ReplaceableTextures/tree/t00/LordaeronTree/LordaeronFallTree");
    handler.write("Yts2", "texFile", "ReplaceableTextures/tree/t00/LordaeronTree/LordaeronSummerTree");
    handler.write("Yts3", "texFile", "ReplaceableTextures/tree/t00/LordaeronTree/LordaeronSummerTree");
    handler.write("STlt", "texFile", "ReplaceableTextures/tree/t00/LordaeronTree/LordaeronSummerTree");
    handler.write("ZTtw", "texFile", "ReplaceableTextures/tree/tc/RuinsTree/RuinsTree");
    handler.write("ZTtc", "texFile", "ReplaceableTextures/tree/tc/RuinsTree/RuinsTree");
    handler.write("BTtw", "texFile", "ReplaceableTextures/tree/tc/barrenstree/barrenstree");
    handler.write("BTtc", "texFile", "ReplaceableTextures/tree/tc/barrenstree/barrenstree");
}
