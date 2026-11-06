import {getVisionModules, setVisionModule} from '../services/vision-modules';
import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import { installBundledResourceFile, removeBundledResourceFile } from '../services/managed-resource-files';
import { glob } from 'glob';
import { promisify } from 'util';
import { getSelectedGameFolder } from '../services/game-channel';

/**
 * 扫描 VisionMod 目录获取模型及贴图文件列表
 */
async function scanVisionMod(visionModPath: string) {
    const candidates = [...new Set([getSelectedGameFolder(), '_retail_', '_ptr_'])];
    const folder = await (async () => {
        for (const candidate of candidates) {
            if (await fs.pathExists(path.join(visionModPath, candidate))) return candidate;
        }
        return null;
    })();
    const retailPath = path.join(visionModPath, folder || getSelectedGameFolder());
    console.log(`[Vision] Scanning VisionMod at: ${retailPath}`);

    if (!(await fs.pathExists(retailPath))) {
        throw new Error(`VisionMod 路径不正确，未找到 _retail_ 目录: ${retailPath}`);
    }

    // 扫描 buildings, doodads, units 目录下的 mdx/mdl 以及贴图 .dds
    const pattern = '{buildings,doodads,units}/**/*.{mdx,mdl,dds}';

    console.log(`[Vision] Using glob pattern: ${pattern}`);

    let allFiles: string[] = [];
    try {
        let globFn: any;
        // @ts-ignore
        if (typeof glob === 'function') {
            // @ts-ignore
            globFn = glob;
        } else if (typeof (glob as any).glob === 'function') {
            globFn = (glob as any).glob;
        }

        if (!globFn) {
            throw new Error('无法找到可用的 glob 函数');
        }

        const result = globFn(pattern, { cwd: retailPath, posix: true });
        if (result && typeof result.then === 'function') {
            allFiles = await result;
        } else {
            allFiles = await promisify(globFn)(pattern, { cwd: retailPath, posix: true }) as string[];
        }
    } catch (e) {
        console.error('[Vision] Glob scan failed:', e);
        throw e;
    }

    console.log(`[Vision] Found ${allFiles.length} files in VisionMod`);

    // 分类文件
    const portraits: string[] = [];
    const enhancements: string[] = [];
    const textures: string[] = [];

    for (const f of allFiles) {
        const lower = f.toLowerCase();
        if (lower.endsWith('.dds')) {
            textures.push(f);
        } else if (lower.endsWith('_portrait.mdx') || lower.endsWith('_portrait.mdl')) {
            portraits.push(f);
        } else {
            enhancements.push(f);
        }
    }

    return { portraits, enhancements, textures, sourcePath: retailPath };
}

export function registerVisionHandlers() {
    console.log('[Vision] Vision handlers registered.');
    ipcMain.handle('vision:modules', (_event, root: string) => getVisionModules(root));
    ipcMain.handle('vision:set-module', (_event, root: string, source: string, module: any, enabled: boolean) => setVisionModule(root,source,module,enabled));

    // 处理半身头像
    ipcMain.handle('vision:update-half-portrait', async (event, war3Path: string, visionModPath: string, enabled: boolean) => {
        console.log(`[Vision] Updating half portrait: ${enabled}`);
        try {
            if(Object.values(await getVisionModules(war3Path)).some(Boolean))throw new Error('请先关闭 Vision Mod 模块，再使用旧版兼容接口');
            if (!visionModPath || !(await fs.pathExists(visionModPath))) {
                throw new Error('未设置或无效的 VisionMod 路径');
            }

            const { portraits, textures, sourcePath: visionRetail } = await scanVisionMod(visionModPath);
            const war3Retail = path.join(war3Path, getSelectedGameFolder());

            // 处理所有头像模型和所有贴图
            const filesToProcess = [...portraits, ...textures];

            for (const relPath of filesToProcess) {
                const targetPath = path.join(war3Retail, relPath);
                const sourcePath = path.join(visionRetail, relPath);
                if (enabled) {
                    await installBundledResourceFile(war3Retail, relPath, sourcePath, [sourcePath], '.quenching-vision-files');
                } else {
                    if (await fs.pathExists(targetPath)) {
                        await removeBundledResourceFile(war3Retail, relPath, [sourcePath], '.quenching-vision-files');
                    }
                }
            }
            return true;
        } catch (error) {
            console.error('[Vision] Failed to update half portrait:', error);
            throw error;
        }
    });

    // 处理模型增强
    ipcMain.handle('vision:update-model-enhance', async (event, war3Path: string, visionModPath: string, enabled: boolean) => {
        console.log(`[Vision] Updating model enhance: ${enabled}`);
        try {
            if(Object.values(await getVisionModules(war3Path)).some(Boolean))throw new Error('请先关闭 Vision Mod 模块，再使用旧版兼容接口');
            if (!visionModPath || !(await fs.pathExists(visionModPath))) {
                throw new Error('未设置或无效比 VisionMod 路径');
            }

            const { enhancements, textures, sourcePath: visionRetail } = await scanVisionMod(visionModPath);
            const war3Retail = path.join(war3Path, getSelectedGameFolder());

            // 处理所有增强模型和所有贴图
            const filesToProcess = [...enhancements, ...textures];

            for (const relPath of filesToProcess) {
                const targetPath = path.join(war3Retail, relPath);
                const sourcePath = path.join(visionRetail, relPath);
                if (enabled) {
                    await installBundledResourceFile(war3Retail, relPath, sourcePath, [sourcePath], '.quenching-vision-files');
                } else {
                    if (await fs.pathExists(targetPath)) {
                        await removeBundledResourceFile(war3Retail, relPath, [sourcePath], '.quenching-vision-files');
                    }
                }
            }
            return true;
        } catch (error) {
            console.error('[Vision] Failed to update model enhance:', error);
            throw error;
        }
    });
}
