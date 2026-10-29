import { resourceArchiveExists } from './bundled-packages';
import { getSelectedGameFolder } from './game-channel';
import fs from 'fs-extra';
import path from 'path';
import { rm } from 'node:fs/promises';
import { configManager } from './config-manager';
import { AssetSyncService } from './asset-sync';
import { extractArchive } from './archive-extraction';
import { withResourceDirectory } from './resource-directory-queue';

export function isQuenchingTerrainMode(terrainMode: string): boolean {
    return terrainMode !== 'original' && terrainMode !== 'classic';
}

export function isRetroTerrainMode(terrainMode: string): boolean {
    return terrainMode === 'retro';
}

export function getFoliageZipName(terrainMode: string): string {
    return terrainMode === 'latest' || terrainMode === 'decisive' || terrainMode === 'v30' || terrainMode === 't30'
        ? 'zip-foliage-que.zip'
        : 'zip-foliage-other.zip';
}

async function resolveBaseDir(war3Path: string): Promise<string> {
    const retailPath = path.join(war3Path, getSelectedGameFolder());
    return (await fs.pathExists(retailPath)) ? retailPath : war3Path;
}

async function removeFoliageDir(environmentDir: string): Promise<void> {
    // Files can stay locked briefly on Windows (game, antivirus, Battle.net).
    await rm(path.join(environmentDir, 'foliage'), { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
}

async function syncFoliageDir(_war3Path: string, environmentDir: string, desiredZipName?: string, onProgress?: (percent: number) => void): Promise<void> {
    return withResourceDirectory(path.join(environmentDir, 'foliage'), () => syncFoliageDirUnlocked(environmentDir, desiredZipName, onProgress));
}

async function syncFoliageDirUnlocked(environmentDir: string, desiredZipName?: string, onProgress?: (percent: number) => void, quenchingDir?: string): Promise<void> {
    onProgress?.(0);
    let zipPath: string | undefined;
    if (desiredZipName) {
        const sourceDir = quenchingDir ?? path.join(await AssetSyncService.getAssetsDir(), 'quenching');
        zipPath = path.join(sourceDir, desiredZipName);
        if (!(await resourceArchiveExists(zipPath))) throw new Error('Foliage zip not found: ' + zipPath);
    }

    // Delete first, then extract a complete fresh copy as requested.
    // Do not rename the active folder, merge files, or reuse a source marker.
    await removeFoliageDir(environmentDir);
    if (!zipPath) {
        onProgress?.(100);
        return;
    }
    onProgress?.(5);
    await fs.ensureDir(environmentDir);
    await extractArchive(zipPath, environmentDir, {
        nativeZip: true, idleTimeoutMs: 90000,
        mapFile: name => {
            if (!name.startsWith('foliage/')) throw new Error('Unexpected foliage package path: ' + name);
            return name;
        },
        onProgress: percent => onProgress?.(5 + percent * .95),
    });
    onProgress?.(100);
}

/** Public environment ZIPs no longer contain foliage; compose its saved variant separately. */
export async function syncPublicEnvironmentFoliage(
    retailDir: string,
    quenchingDir: string,
    modSettings: Record<string, unknown>,
    refresh: boolean,
    onProgress?: (percent: number) => void,
): Promise<void> {
    const environmentDir = path.join(retailDir, 'environment');
    const foliageDir = path.join(environmentDir, 'foliage');
    return withResourceDirectory(foliageDir, async () => {
        const terrain = typeof modSettings?.terrain === 'string' ? modSettings.terrain : 'latest';
        const enabled = modSettings?.foliage !== false && !isRetroTerrainMode(terrain);
        const exists = await fs.pathExists(foliageDir);
        if (!enabled) {
            if (exists) await syncFoliageDirUnlocked(environmentDir, undefined, onProgress);
            else onProgress?.(100);
            return;
        }
        // Lighting-only changes must not repeatedly delete/extract unchanged foliage.
        if (!refresh && exists) { onProgress?.(100); return; }
        await syncFoliageDirUnlocked(environmentDir, getFoliageZipName(terrain), onProgress, quenchingDir);
        if (!await fs.pathExists(foliageDir)) throw new Error(`Foliage extract failed, missing ${foliageDir}`);
    });
}

export async function applyFoliageSettings(
    war3Path: string,
    enabled: boolean,
    terrainMode?: string,
    onProgress?: (percent: number) => void,
): Promise<void> {
    // Reserve request order before asynchronous path checks can reorder callers.
    return withResourceDirectory(war3Path, () => applyFoliageSettingsUnlocked(war3Path, enabled, terrainMode, onProgress));
}

async function applyFoliageSettingsUnlocked(
    war3Path: string, enabled: boolean, terrainMode?: string, onProgress?: (percent: number) => void,
): Promise<void> {
    const baseDir = await resolveBaseDir(war3Path);
    const environmentDir = path.join(baseDir, 'environment');

    const mode = terrainMode ?? configManager.get('modSettings')?.terrain ?? 'latest';

    if (isRetroTerrainMode(mode)) {
        console.log('[Foliage] Retro terrain, removing foliage directory');
        await syncFoliageDir(war3Path, environmentDir, undefined, onProgress);
        const modSettings = configManager.get('modSettings') || {};
        if (modSettings.foliage !== false) {
            configManager.set('modSettings', { ...modSettings, foliage: false });
        }
        return;
    }

    if (!enabled) {
        console.log('[Foliage] Disabling... Removing foliage directory');
        await syncFoliageDir(war3Path, environmentDir, undefined, onProgress);
        return;
    }

    const zipName = getFoliageZipName(mode);
    console.log(`[Foliage] Enabling with ${zipName} for terrain mode: ${mode}`);
    await syncFoliageDir(war3Path, environmentDir, zipName, onProgress);

    const foliageDir = path.join(environmentDir, 'foliage');
    if (!(await fs.pathExists(foliageDir))) {
        throw new Error(`Foliage extract failed, missing ${foliageDir}`);
    }

    console.log(`[Foliage] Applied ${zipName} -> environment/foliage`);
}

export async function syncFoliageForTerrainIfEnabled(
    war3Path: string,
    terrainMode: string,
    previousTerrainMode?: string,
    onProgress?: (percent: number) => void,
): Promise<void> {
    return withResourceDirectory(war3Path, () => syncFoliageForTerrainUnlocked(war3Path, terrainMode, previousTerrainMode, onProgress));
}

async function syncFoliageForTerrainUnlocked(
    war3Path: string, terrainMode: string, previousTerrainMode?: string, onProgress?: (percent: number) => void,
): Promise<void> {
    if (isRetroTerrainMode(terrainMode)) {
        const baseDir = await resolveBaseDir(war3Path);
        console.log('[Foliage] Retro terrain switch, removing foliage directory');
        await syncFoliageDir(war3Path, path.join(baseDir, 'environment'), undefined, onProgress);
        const modSettings = configManager.get('modSettings') || {};
        if (modSettings.foliage !== false) {
            configManager.set('modSettings', { ...modSettings, foliage: false });
        }
        return;
    }

    const modSettings = configManager.get('modSettings') || {};
    const leavingRetro = previousTerrainMode !== undefined && isRetroTerrainMode(previousTerrainMode);

    if (modSettings.foliage === false && !leavingRetro) {
        console.log('[Foliage] foliage disabled in config, skipping terrain-linked foliage sync');
        onProgress?.(100);
        return;
    }

    console.log(
        `[Foliage] Terrain switch ${previousTerrainMode ?? '?'} -> ${terrainMode}, applying ${getFoliageZipName(terrainMode)}`
    );
    await applyFoliageSettingsUnlocked(war3Path, true, terrainMode, onProgress);
}

export async function syncFoliageOnStartup(war3Path: string, modSettings: Record<string, unknown>): Promise<void> {
    return withResourceDirectory(war3Path, () => syncFoliageOnStartupUnlocked(war3Path, modSettings));
}

async function syncFoliageOnStartupUnlocked(war3Path: string, modSettings: Record<string, unknown>): Promise<void> {
    const baseDir = await resolveBaseDir(war3Path);
    const environmentDir = path.join(baseDir, 'environment');
    const terrainMode = (modSettings.terrain as string | undefined) ?? 'latest';

    if (isRetroTerrainMode(terrainMode)) {
        console.log('[Foliage] Retro terrain on startup, removing foliage directory');
        await syncFoliageDir(war3Path, environmentDir);
        if (modSettings.foliage !== false) {
            configManager.set('modSettings', { ...modSettings, foliage: false });
        }
        return;
    }

    if (modSettings.foliage === false) {
        console.log('[Foliage] foliage=false in config, cleaning up foliage directory on startup');
        await syncFoliageDir(war3Path, environmentDir);
        return;
    }

    const foliageDir = path.join(environmentDir, 'foliage');
    if (await fs.pathExists(foliageDir)) {
        return;
    }

    console.log(`[Foliage] foliage enabled but directory missing, applying ${getFoliageZipName(terrainMode)}`);
    await applyFoliageSettingsUnlocked(war3Path, true, terrainMode);
}
