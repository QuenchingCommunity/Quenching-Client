import {
    applyTreeSkinRules,
    D16_CITYSCAPE_COUNT,
    D16_CITYSCAPE_MODEL,
    D16_CITYSCAPE_SEASONS,
    D16_CITYSCAPE_SNOW,
    D16_CITYSCAPE_TEXTURE,
    D18_TREE_ASSETS,
    type InstalledCityscape,
} from '../../shared/tree-skin-rules';
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

/** 确认一套 D18 资产的每个编号模型及正常、腐地两套 DDS 都已安装。 */
async function hasD18TreeAssets(baseDir: string): Promise<boolean> {
    const paths = D18_TREE_ASSETS.flatMap(({ model, texture, count }) => [
        ...Array.from({ length: count }, (_, index) => `doodads/que/d18/${model}${index}.mdx`),
        ...['', 'blight'].flatMap(variant => ['diffuse', 'normal', 'orm'].map(role =>
            `replaceabletextures/tree/t18/${texture}${variant}_${role}.dds`)),
    ]);
    return (await Promise.all(paths.map(file => fs.pathExists(path.join(baseDir, file))))).every(Boolean);
}

/** 检查三种现有树形及站立／树桩文件，再确认三季图集和新增雪地图集的安装状态。 */
async function installedCityscapeAssets(baseDir: string): Promise<InstalledCityscape | undefined> {
    const models = Array.from({ length: D16_CITYSCAPE_COUNT }, (_, index) =>
        ['', 'd', 's'].map(state => `${D16_CITYSCAPE_MODEL}${index}${state}.mdx`)).flat();
    const textures = (seasons: readonly string[]) => seasons.flatMap(season =>
        ['', 'blight'].flatMap(variant => ['diffuse', 'normal', 'orm'].map(role =>
            `${D16_CITYSCAPE_TEXTURE}${season}${variant}_${role}.dds`)));
    const exists = (file: string) => fs.pathExists(path.join(baseDir, file));
    const modern = await Promise.all([...models, ...textures(Object.values(D16_CITYSCAPE_SEASONS))].map(exists));
    if (!modern.every(Boolean)) return undefined;
    const snow = await Promise.all(textures([D16_CITYSCAPE_SNOW]).map(exists));
    return snow.every(Boolean) ? 'snow' : 'seasonal';
}

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
            const isD18 = treeMode === 'v18';
            // D16 和 D18 的 HD／DE 配置共用圆冠资产，SD 保留旧树木路径。
            const [d18, cityscape] = await Promise.all([
                isD18 && hasD18TreeAssets(baseDir),
                (isD18 || treeMode === 'v16') && profile.graphics !== 'sd' ? installedCityscapeAssets(baseDir) : undefined,
            ]);
            if (!applyTreeSkinRules(treeMode, handler, { d18, cityscape })) {
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
