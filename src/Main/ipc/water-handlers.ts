import { getSelectedGameFolder } from '../services/game-channel';
import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import { AssetSyncService } from '../services/asset-sync';
import { assertFullPackageInstalled } from '../services/full-package-service';
import { configManager } from '../services/config-manager';
import { resolveModProfile } from '../services/mod-profile';
import { removeActiveWaterOverrides, stripWaterForDe } from '../services/graphics-layout-service';
import { copyWaterModeFromAssets, verifyWaterModeAssets } from '../services/water-assets-service';

export async function applyWaterSettings(war3Path: string, waterMode: string): Promise<void> {
    if (!war3Path) throw new Error('未提供魔兽路径');

    const modSettings = configManager.get('modSettings') || {};
    const profile = await resolveModProfile(war3Path, {
        versionSelection: modSettings.versionSelection,
        graphicsSelection: modSettings.graphicsSelection,
        classicMode: modSettings.classicMode === true,
    });
    const assetsDir = await AssetSyncService.getAssetsDir(["water","tile"]);

    // DE cannot adjust water — keep textures/slk stripped.
    if (profile.graphics === 'de') {
        console.log('[Water] DE graphics: water adjustments disabled, stripping water resources');
        await stripWaterForDe(war3Path);
        return;
    }

    await assertFullPackageInstalled(war3Path);

    const retailPath = path.join(war3Path, getSelectedGameFolder());
    const baseDir = (await fs.pathExists(retailPath)) ? retailPath : war3Path;

    if (waterMode === 'off') {
        await removeActiveWaterOverrides(baseDir);
        console.log('[Water] Warcraft default water is active');
        return;
    }

    if (waterMode !== 'transparent' && waterMode !== 'realistic') {
        throw new Error(`Unknown water mode: ${waterMode}`);
    }
    console.log(`[Water] Mode: ${waterMode} execution...`);
    await verifyWaterModeAssets(assetsDir, waterMode);
    await removeActiveWaterOverrides(baseDir);
    await copyWaterModeFromAssets(baseDir, assetsDir, waterMode);

    console.log(`[Water] ALL OPERATIONS COMPLETED for mode: ${waterMode}`);
}

export function registerWaterHandlers() {
    console.log('[Water] Water handlers registered.');

    ipcMain.handle('water:update-settings', async (_event, war3Path: string, waterMode: string) => {
        console.log(`\n>>> [Water] Updating water to mode: ${waterMode}`);
        try {
            await applyWaterSettings(war3Path, waterMode);
            return true;
        } catch (error) {
            console.error('[Water] Failed to update water settings:', error);
            throw error;
        }
    });
}
