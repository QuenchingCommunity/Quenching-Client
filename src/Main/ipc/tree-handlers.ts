import {assertVisionSettingAllowed} from '../services/vision-modules';
import { getSelectedGameFolder } from '../services/game-channel';
import { ipcMain } from 'electron';
import fs from 'fs-extra';
import path from 'path';
import { rm } from 'node:fs/promises';
import { AssetSyncService } from '../services/asset-sync';
import { assertTreeModeAvailable } from '../services/full-package-service';
import { resolveModProfile } from '../services/mod-profile';
import { installBundledResourceFile } from '../services/managed-resource-files';
import { readCurrentModVersion } from '../services/mod-integrity-service';
import { getInstalledModState } from '../services/mod-update-service';
import { destructableSkinTemplate } from '../services/destructable-skin-profile';
import type { ModProfile } from '../../shared/mod-profile';

/**
 * 魔兽文本文件处理器 (用于处理 destructableskin.txt 等类似 INI 的文件)
 */
class War3TextHandler {
    private data: Map<string, Map<string, string>> = new Map();

    getData() { return this.data; }

    async readFile(filePath: string) {
        this.data.clear();
        console.log(`[Tree] Reading file: ${filePath}`);
        if (!(await fs.pathExists(filePath))) {
            console.error(`[Tree] File not found: ${filePath}`);
            return;
        }
        let content = await fs.readFile(filePath, 'utf-8');
        // Handle BOM
        if (content.charCodeAt(0) === 0xFEFF) {
            content = content.slice(1);
        }

        const lines = content.split(/\r?\n/);
        let currentSection: Map<string, string> | null = null;

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                const sectionName = trimmed.slice(1, -1).trim();
                currentSection = new Map();
                this.data.set(sectionName, currentSection);
            } else if (trimmed.includes('=') && currentSection) {
                const [key, ...valueParts] = trimmed.split('=');
                currentSection.set(key.trim(), valueParts.join('=').trim());
            }
        }
        console.log(`[Tree] Parsed ${this.data.size} sections from ${filePath}`);
    }

    write(section: string, key: string, value: string) {
        let sectionMap = this.data.get(section);
        if (!sectionMap) {
            sectionMap = new Map();
            this.data.set(section, sectionMap);
        }
        // 3.0 moved some shared tree textures to an explicit SD field.
        const field = key === 'texFile' && !sectionMap.has(key) && sectionMap.has('texFile:sd')
            ? 'texFile:sd' : key;
        sectionMap.set(field, value);
    }

    async saveFile(filePath: string) {
        let output = '';
        for (const [sectionName, sectionMap] of this.data) {
            output += `[${sectionName}]\r\n`;
            for (const [key, value] of sectionMap) {
                output += `${key}=${value}\r\n`;
            }
            output += '\r\n';
        }
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, output, 'utf-8');
        console.log(`[Tree] Saved to ${filePath}`);
    }
}

export function registerTreeHandlers() {
    console.log('[Tree] Tree handlers registered and ready.');
    /**
     * 更新树木设置
     */
    ipcMain.handle('tree:update-settings', async (event, war3Path: string, treeMode: string) =>
        applyTreeSettings(war3Path, treeMode));
}

/** Used by both manual tree choices and profile synchronization. */
export async function applyTreeSettings(
    war3Path: string,
    treeMode: string,
    resolvedProfile?: ModProfile,
    quenchingDir?: string,
) {
        await assertVisionSettingAllowed(war3Path,'tree');
        console.log('\n\n==================================================');
        console.log(`[Tree] IPC RECEIVED: mode=${treeMode}, path=${war3Path}`);
        try {
            if (!war3Path) throw new Error('未提供魔兽路径');

            const retailPath = path.join(war3Path, getSelectedGameFolder());
            const baseDir = (await fs.pathExists(retailPath)) ? retailPath : war3Path;
            const targetPath = path.join(baseDir, 'units', 'destructableskin.txt');
            if (!(await readCurrentModVersion(war3Path)) && (await getInstalledModState(war3Path))?.sequence === 34) {
                throw new Error('请先将 3.4 MOD 更新到 3.5，再切换树木资源');
            }

            // 找到基准原版文件
            const skinAssetsDir = quenchingDir ?? path.join(await AssetSyncService.getAssetsDir(["skin"]), 'quenching');
            const modSettings = (await import('../services/config-manager')).configManager.get('modSettings') || {};
            const profile = resolvedProfile ?? await resolveModProfile(war3Path, {
                versionSelection: modSettings.versionSelection,
                graphicsSelection: modSettings.graphicsSelection,
                classicMode: modSettings.classicMode === true,
            });
            let sourcePath = destructableSkinTemplate(skinAssetsDir, profile.graphics, profile.version, treeMode);

            // HD/SD original prefers the dedicated destructableskin.txt; fall back to -org.
            if (treeMode === 'original' && profile.graphics !== 'de' && !(await fs.pathExists(sourcePath))) {
                sourcePath = destructableSkinTemplate(skinAssetsDir, profile.graphics, profile.version, 'tall');
            }

            console.log(`[Tree] Using baseline: ${sourcePath}`);

            if (!(await fs.pathExists(sourcePath))) {
                console.error(`[Tree] Baseline file NOT FOUND: ${sourcePath}`);
                throw new Error(`基准树木配置文件不存在: ${sourcePath}`);
            }

            if (treeMode !== 'original') {
                await assertTreeModeAvailable(war3Path, treeMode);
            }

            const install = (source: string) => installBundledResourceFile(
                path.join(baseDir, 'units'), 'destructableskin.txt', source, [], '.quenching-profile-skin',
            );
            if (treeMode === 'original') {
                // Original is an exact bundled/baseline file, not a generated
                // tree variant. This also covers DE's destructableskin-de.txt.
                await install(sourcePath);
                console.log(`[Tree] Restored original tree baseline to ${targetPath}`);
                return true;
            }

            // Generate a client-owned variant in staging before touching the game.
            const handler = new War3TextHandler();
            await handler.readFile(sourcePath);
            console.log(`[Tree] Original data loaded. Sections: ${Array.from(handler.getData().keys()).length}`);

            console.log(`[Tree] MODIFY: Applying ${treeMode} rules onto original data...`);
            switch (treeMode) {
                case 'tall': applyTo20(handler); break;
                case 'short': applyTo20Short(handler); break;
                case 'v18': applyTo18(handler); break;
                case 'v16': applyTo16(handler); break;
                case 'retro': applyTo00(handler); break;
                default:
                    console.warn(`[Tree] Unknown mode ${treeMode}, just saving baseline.`);
            }

            const staging = await fs.mkdtemp(path.join(baseDir, '.quenching-tree-skin-'));
            try {
                const generated = path.join(staging, 'destructableskin.txt');
                await handler.saveFile(generated);
                await install(generated);
            } finally {
                await rm(staging, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
            }

            console.log(`[Tree] SUCCESSFULLY updated tree to ${treeMode}`);
            return true;

        } catch (error) {
            console.error('[Tree] Failed to update tree settings:', error);
            throw error;
        }
}

function applyTo20(handler: War3TextHandler) {
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

function applyTo20Short(handler: War3TextHandler) {
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

function applyTo18(handler: War3TextHandler) {
    handler.write("ATtr", "texFile", "ReplaceableTextures/tree/t18/AshenvaleTree/AshenTree");
    handler.write("BTtw", "texFile", "ReplaceableTextures/tree/t18/BarrensTree/BarrensTree");
    handler.write("CTtr", "texFile", "ReplaceableTextures/tree/t18/AshenvaleTree/FelwoodTree");
    handler.write("FTtw", "texFile", "ReplaceableTextures/tree/t18/LordaeronTree/LordaeronFallTree");
    handler.write("FTtw", "file", "Doodads/que/d18/LordaeronTree/LordaeronTree");
    handler.write("LTlt", "texFile", "ReplaceableTextures/tree/t18/LordaeronTree/LordaeronSummerTree");
    handler.write("LTlt", "file", "Doodads/que/d18/LordaeronTree/LordaeronTree");
    handler.write("WTtw", "texFile", "ReplaceableTextures/tree/t18/LordaeronTree/LordaeronWinterTree");
    handler.write("WTtw", "file", "Doodads/que/d18/LordaeronTree/LordaeronTree");
    handler.write("WTst", "texFile", "ReplaceableTextures/tree/t18/LordaeronTree/LordaeronSnowTree");
    handler.write("WTst", "file", "Doodads/que/d18/LordaeronTree/LordaeronTree");
    handler.write("YTct", "texFile", "ReplaceableTextures/tree/tc/citytree/cityscapetree");
    handler.write("YTct", "file", "Doodads/que/d18/Citytree");
    handler.write("YTwt", "texFile", "ReplaceableTextures/tree/tc/citytree/cityscapetreew");
    handler.write("YTwt", "file", "Doodads/que/d18/Citytree");
    handler.write("YTft", "texFile", "ReplaceableTextures/tree/tc/citytree/cityscapetreea");
    handler.write("YTft", "file", "Doodads/que/d18/Citytree");
    handler.write("VTlt", "texFile", "ReplaceableTextures/tree/t18/LordaeronTree/lordaeronvillagetree");
    handler.write("VTlt", "file", "Doodads/que/d18/LordaeronTree/LordaeronTree");
    handler.write("ATt1", "texFile", "ReplaceableTextures/tree/t18/AshenvaleTree/AshenTree");
    handler.write("ATtc", "texFile", "ReplaceableTextures/tree/t18/AshenvaleTree/AshenCanopyTree");
    handler.write("JTct", "texFile", "ReplaceableTextures/tree/t18/lordaerontree/lordaeronsummertree");
    handler.write("JTct", "file", "Doodads/que/d18/lordaerontree/lordaerontree");
    handler.write("JTtw", "texFile", "ReplaceableTextures/tree/t18/lordaerontree/lordaeronsummertree");
    handler.write("JTtw", "file", "Doodads/que/d18/LordaeronTree/LordaeronTree");
    handler.write("BTtc", "texFile", "ReplaceableTextures/tree/t18/BarrensTree/BarrensTree");
    handler.write("CTtc", "texFile", "ReplaceableTextures/tree/t18/AshenvaleTree/FelwoodCanopyTree");
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
}

function applyTo16(handler: War3TextHandler) {
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
    handler.write("YTct", "texFile", "ReplaceableTextures/tree/tc/citytree/cityscapetree");
    handler.write("YTct", "file", "Doodads/que/d16/Citytree");
    handler.write("YTwt", "texFile", "ReplaceableTextures/tree/tc/citytree/cityscapetreew");
    handler.write("YTwt", "file", "Doodads/que/d16/Citytree");
    handler.write("YTft", "texFile", "ReplaceableTextures/tree/tc/citytree/cityscapetreea");
    handler.write("YTft", "file", "Doodads/que/d16/Citytree");
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

function applyTo00(handler: War3TextHandler) {
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
