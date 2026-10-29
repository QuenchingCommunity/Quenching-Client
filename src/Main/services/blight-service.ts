import { resourceArchiveExists } from './bundled-packages';
import { getChannelModEnabled, getSelectedGameChannel, getSelectedGameFolder } from './game-channel';
import fs from 'fs-extra';
import path from 'path';
import { rm } from 'node:fs/promises';
import { AssetSyncService } from './asset-sync';
import { isBranchModDisabled } from './branch-mod-toggle';

export function getBlightZipName(enabled = true): string | null {
    return enabled ? 'zip-blight-que.zip' : null;
}

async function resolveBaseDir(war3Path: string): Promise<string> {
    const retailPath = path.join(war3Path, getSelectedGameFolder());
    return (await fs.pathExists(retailPath)) ? retailPath : war3Path;
}

/** Original blight = no terrainart/blight; Quenching blight = the bundled zip extracted there. */
export async function applyBlightSettings(war3Path: string, enabled: boolean): Promise<void> {
    if (!getChannelModEnabled(getSelectedGameChannel())) return;
    const baseDir = await resolveBaseDir(war3Path);
    if (await isBranchModDisabled(baseDir)) return;
    const terrainArtPath = path.join(baseDir, 'terrainart');
    const blightDir = path.join(terrainArtPath, 'blight');
    await rm(blightDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });

    const zipName = getBlightZipName(enabled);
    if (!zipName) {
        console.log('[Blight] Original effect selected, removed terrainart/blight');
        return;
    }
    const zipPath = path.join(await AssetSyncService.getAssetsDir(), 'quenching', zipName);
    if (!(await resourceArchiveExists(zipPath))) throw new Error(`Blight zip not found: ${zipPath}`);
    await fs.ensureDir(terrainArtPath);
    await AssetSyncService.extractZip(zipPath, terrainArtPath);
    if (!(await fs.pathExists(blightDir))) throw new Error(`Blight extract failed, missing ${blightDir}`);
    console.log(`[Blight] Applied ${zipName} -> terrainart/blight`);
}

export async function syncBlightOnStartup(war3Path: string, modSettings: Record<string, unknown>): Promise<void> {
    await applyBlightSettings(war3Path, modSettings.blight !== false);
}
