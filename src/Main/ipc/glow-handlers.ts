import { resourcePath } from '../../shared/bundled-resource-paths.mjs';
import { getSelectedGameFolder } from '../services/game-channel';
import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import { AssetSyncService } from '../services/asset-sync';

const GLOW_RELATIVE = path.join('textures', 'fx', 'flare', 'heroglow_bw.dds');
const ASSET_GLOW_NAME = 'heroglow_bw.dds';
const LEGACY_GLOW_MARKER = '.quenching-managed-glow.json';

async function resolveBaseDir(war3Path: string): Promise<string> {
    const retailPath = path.join(war3Path, getSelectedGameFolder());
    return (await fs.pathExists(retailPath)) ? retailPath : war3Path;
}

async function removeLegacyGlowLeftovers(baseDir: string): Promise<void> {
    await fs.remove(path.join(baseDir, 'textures', 'fx', 'flare', LEGACY_GLOW_MARKER));
    await fs.remove(path.join(baseDir, 'QMoff', GLOW_RELATIVE));
}

export function registerGlowHandlers() {
    console.log('[Glow] Glow handlers registered.');

    ipcMain.handle('glow:update-settings', async (_event, war3Path: string, enabled: boolean) => {
        // enabled=true → weak (install client asset); enabled=false → strong (remove local override)
        console.log(`\n>>> [Glow] Updating hero glow: ${enabled ? 'WEAK' : 'STRONG'}`);
        try {
            if (!war3Path) throw new Error('未提供魔兽路径');

            const baseDir = await resolveBaseDir(war3Path);
            const glowFile = path.join(baseDir, GLOW_RELATIVE);

            if (enabled) {
                const assetsDir = await AssetSyncService.getAssetsDir(["tx"]);
                const source = resourcePath(path.join(assetsDir, 'quenching'), 'tx', ASSET_GLOW_NAME);
                if (!(await fs.pathExists(source))) {
                    throw new Error(`光晕资源不存在: ${source}`);
                }
                await fs.ensureDir(path.dirname(glowFile));
                await fs.copy(source, glowFile, { overwrite: true });
                console.log(`[Glow] Installed WEAK glow from assets → ${glowFile}`);
            } else {
                await fs.remove(glowFile);
                console.log(`[Glow] Removed local glow override → STRONG (CASC default): ${glowFile}`);
            }
            await removeLegacyGlowLeftovers(baseDir);

            return true;
        } catch (error) {
            console.error('[Glow] Failed to update glow settings:', error);
            throw error;
        }
    });
}
