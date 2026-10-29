import { getChannelModEnabled, getSelectedGameChannel, getSelectedGameFolder } from '../services/game-channel';
import { ipcMain } from 'electron';
import path from 'path';
import { rm } from 'node:fs/promises';
import fs from 'fs-extra';
import { AssetSyncService, getKnownShaderResourceRoots } from '../services/asset-sync';
import { extractZipArchive } from '../services/zip-extraction';
import { configManager } from '../services/config-manager';
import {
    detectWar3Version,
    isShaderPackCurrent,
    normalizeShaderExtractLayout,
    writeShaderPackMarker,
    type War3VersionInfo,
} from '../services/war3-version';
import { getShaderPackRoot, getShaderResourcePath, resolveModProfile } from '../services/mod-profile';
import { ModProfile, isHdShaderPack, isVersion30OrLater, assertShaderProfileSupported } from '../../shared/mod-profile';
import { withShaderBundle, selectShaderBundleResources } from '../services/shader-bundle';
import { syncProfileResources } from '../services/asset-sync';
import { syncBundledResourceFiles, copyBundledResourceIfChanged } from '../services/managed-resource-files';
import { getInstalledModState } from '../services/mod-update-service';
import { isFullPackageInstalled } from '../services/full-package-service';
import { isThirdPartyQuenchingPaused } from '../services/third-party-resources';
import { readCurrentModVersion } from '../services/mod-integrity-service';
import { prepareShaderToggles, OBJECT_SHADER_FILES, POST_PROCESSING_GLOW_FILES, POST_PROCESSING_SHADOW_FILES, HDR_SHADER_FILES, supportsHdr } from '../services/fog-shader-override';
const SHADER_PROFILE_MARKER = '.quenching-shader-profile';



interface ResolvedShaderSource {
    zipName: string;
    zipPath: string;
    isDirectory: boolean;
    bundledArchive?: boolean;
    profile?: ModProfile;
    shaderQuenchingDir?: string;
}

async function resolveShadersBaseDir(war3Path: string): Promise<string> {
    const retailPath = path.join(war3Path, getSelectedGameFolder());
    return (await fs.pathExists(retailPath)) ? retailPath : war3Path;
}

async function resolveCurrentShaderProfile(war3Path: string, overrides: Record<string, unknown> = {}) {
    const modSettings = { ...(configManager.get('modSettings') || {}), ...overrides };
    const profile = await resolveModProfile(war3Path, {
        versionSelection: modSettings.versionSelection,
        graphicsSelection: modSettings.graphicsSelection,
        classicMode: modSettings.classicMode === true,
        lighting: modSettings.lighting,
    });
    assertShaderProfileSupported(profile);
    return { profile, modSettings };
}

async function applyCurrentShaderToggles(
    war3Path: string, overrides: Record<string, unknown> = {}, installFiles: string[] = [],
): Promise<void> {
    const { profile, modSettings } = await resolveCurrentShaderProfile(war3Path, overrides);
    const shadersDir = path.join(await resolveShadersBaseDir(war3Path), 'shaders');
    const quenchingDir = path.join(await AssetSyncService.getAssetsDir(), 'quenching');
    await withShaderBundle(quenchingDir, profile.shaderPack, path.dirname(shadersDir), async shaderQuenchingDir => {
        const apply = await prepareShaderToggles(shaderQuenchingDir, profile, modSettings);
        if (installFiles.length) {
            await installShaderFiles(war3Path, {
                zipName: profile.shaderPack,
                zipPath: getShaderResourcePath(shaderQuenchingDir, profile, modSettings.lighting || 'standard'),
                isDirectory: true, profile, shaderQuenchingDir,
            }, installFiles);
        }
        await apply(shadersDir);
        if (installFiles.length) await writeShaderPackMarker(shadersDir, profile.shaderPack);
    }, selectShaderBundleResources(profile, modSettings, installFiles));
    await AssetSyncService.ensurePostProcessingConfig(war3Path, undefined,
        supportsHdr(profile) && (modSettings.hdr ?? modSettings.postProcessing !== false), modSettings.postProcessingGlow !== false);
    // Object/shadow switches affect unit scales only when readability is enabled.
    if (overrides.improveReadability === undefined && modSettings.improveReadability !== true) return;
    const { syncUnitSkinBattleMode, skinProfileForGraphics, skinEraForVersion } = await import('../services/unit-skin-profile');
    await syncUnitSkinBattleMode(path.dirname(shadersDir), skinProfileForGraphics(profile.graphics,
        configManager.get('retroSkinUnits') === true, configManager.get('retroSkinBuildings') === true),
        skinEraForVersion(profile.version), { ...modSettings, resolvedVersion: profile.version });
}

async function resolveVersionedShaderZipPath(war3Path: string): Promise<ResolvedShaderSource | null> {
    const assetsDir = await AssetSyncService.getAssetsDir();
    const { profile, modSettings } = await resolveCurrentShaderProfile(war3Path);
    const quenchingDir = path.join(assetsDir, 'quenching');
    await withShaderBundle(quenchingDir, profile.shaderPack, await resolveShadersBaseDir(war3Path), async () => {}, selectShaderBundleResources(profile, modSettings));
    const sourceDir = getShaderResourcePath(quenchingDir, profile, modSettings.lighting || 'standard');
    if (await fs.pathExists(sourceDir)) {
        return { zipName: profile.shaderPack, zipPath: sourceDir, isDirectory: true };
    }
    throw new Error(`Missing ${profile.shaderPack} shader resources: ${sourceDir}`);
}

/**
 * Ensure `_retail_/shaders` matches the pack selected from the detected War3 version.
 * Re-extracts when the pack marker is missing or points at a different zip.
 */
export async function ensureVersionedShaders(
    war3Path: string,
    options?: { force?: boolean }
): Promise<{ success: boolean; zipName?: string; version?: War3VersionInfo }> {
    const version = await detectWar3Version(war3Path);
    const settings = configManager.get('modSettings');
    if (settings?.graphicsSelection === 'sd' || settings?.classicMode === true) {
        return { success: false, version };
    }
    if (!(await readCurrentModVersion(war3Path)) && (await getInstalledModState(war3Path))?.sequence === 34) {
        console.log('[Shader] Legacy 3.4 package detected; postponing shader profile sync until after the 3.5 patch.');
        return { success: false, version };
    }
    const resolved = await resolveVersionedShaderZipPath(war3Path);
    if (!resolved) {
        return { success: false, version };
    }

    const baseDir = await resolveShadersBaseDir(war3Path);
    const shadersDir = path.join(baseDir, 'shaders');
    const force = options?.force === true;

    if (!force && (await isShaderPackCurrent(shadersDir, resolved.zipName))) {
        console.log(`[Shader] Pack already current: ${resolved.zipName}`);
        return { success: true, zipName: resolved.zipName, version };
    }

    console.log(`[Shader] Applying versioned shaders: ${resolved.zipName} (War3 ${version.version || 'unknown'})`);
    if (resolved.isDirectory || resolved.bundledArchive) {
        const modSettings = configManager.get('modSettings') || {};
        await syncProfileResources(war3Path, path.join(await AssetSyncService.getAssetsDir(), 'quenching'), modSettings);
    } else {
        const staging = await fs.mkdtemp(path.join(path.dirname(shadersDir), '.quenching-shaders-'));
        try {
            await AssetSyncService.extractZip(resolved.zipPath, staging);
            await normalizeShaderExtractLayout(staging);
            // Shader overlays are client-managed; do not retain unknown files
            // from a previous shader pack when applying a new profile.
            await fs.remove(shadersDir);
            await syncBundledResourceFiles(shadersDir, [{ source: staging }], [], SHADER_PROFILE_MARKER, { removeAbsent: false });
        } finally {
            await rm(staging, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
        }
    }
    await writeShaderPackMarker(shadersDir, resolved.zipName);
    // syncProfileResources already applies the toggles to its prepared shaders.
    if (!resolved.isDirectory && !resolved.bundledArchive) await applyCurrentShaderToggles(war3Path);

    return { success: true, zipName: resolved.zipName, version };
}

/** @deprecated Manual toggle removed; always auto-selects from War3 version. */
async function applyLegacyShaderVersion(war3Path: string, _enabled?: boolean): Promise<boolean> {
    const result = await ensureVersionedShaders(war3Path, { force: true });
    return result.success;
}

async function extractSpecificFiles(zipPath: string, outputDir: string, filesToExtract: string[]) {
    if (await fs.pathExists(zipPath) && (await fs.stat(zipPath)).isDirectory()) {
        const wanted = new Set(filesToExtract.map((f) => f.toLowerCase()));
        const stack = [zipPath];
        while (stack.length) {
            const current = stack.pop()!;
            for (const entry of await fs.readdir(current, { withFileTypes: true })) {
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) stack.push(full);
                else if (wanted.has(entry.name.toLowerCase())) {
                    const relative = path.relative(zipPath, full).replace(/\\/g, '/').toLowerCase();
                    const key = relative.includes('/') ? relative : `ps/${relative}`;
                    if (!wanted.has(key)) continue;
                    const target = path.join(outputDir, key);
                    await fs.ensureDir(path.dirname(target));
                    await fs.copy(full, target, { overwrite: true });
                }
            }
        }
        return;
    }
    const wanted = new Set(filesToExtract.map(file => file.toLowerCase()));
    await extractZipArchive(zipPath, outputDir, {
        mapFile: (name) => {
            const normalized = name.replace(/\\/g, '/');
            const lower = normalized.toLowerCase().replace(/^\.\//, '');
            const parts = lower.split('/');
            if (parts.length === 1 && wanted.has(`ps/${parts[0]}`)) return `ps/${parts[0]}`;
            if (parts.length === 2 && (parts[0] === 'ps' || parts[0] === 'vs') && wanted.has(lower)) return lower;
            return null;
        },
    });
}

async function stageProfileShaderFiles(
    resolved: ResolvedShaderSource,
    files: string[],
    outputDir: string,
): Promise<number> {
    if (resolved.bundledArchive) {
        const profile = resolved.profile!;
        const quenchingDir = path.join(await AssetSyncService.getAssetsDir(), 'quenching');
        return withShaderBundle(quenchingDir, profile.shaderPack, path.dirname(outputDir), shaderQuenchingDir =>
            stageProfileShaderFiles({ ...resolved, bundledArchive: false, isDirectory: true, shaderQuenchingDir,
                zipPath: getShaderResourcePath(shaderQuenchingDir, profile, (configManager.get('modSettings') || {}).lighting || 'standard') }, files, outputDir));
    }
    if (!resolved.isDirectory) {
        await extractSpecificFiles(resolved.zipPath, outputDir, files);
        let copied = 0;
        for (const file of files) {
            if (await fs.pathExists(path.join(outputDir, file))) copied++;
        }
        return copied;
    }

    const assetsDir = await AssetSyncService.getAssetsDir();
    const quenchingDir = resolved.shaderQuenchingDir || path.join(assetsDir, 'quenching');
    const candidatesFor = (key: string): string[] => {
        const [stage, name] = key.split('/');
        const candidates: string[] = [];
        if (isHdShaderPack(resolved.zipName as ModProfile['shaderPack'])) {
            const hdRoot = getShaderPackRoot(quenchingDir, { shaderPack: resolved.zipName as ModProfile['shaderPack'] });
            if (stage === 'ps') {
                candidates.push(path.join(resolved.zipPath, name));
                for (const variant of ['standard', 'melee']) {
                    candidates.push(path.join(hdRoot, 'ps', variant, name));
                }
            } else {
                candidates.push(path.join(hdRoot, 'vs', name));
            }
        } else {
            if (stage === 'vs' && (resolved.zipName === 'shaders-300-de' || resolved.zipName === 'shaders-ptr-de')) {
                candidates.push(path.join(getShaderPackRoot(quenchingDir, { shaderPack: resolved.zipName as ModProfile['shaderPack'] }), 'vs', name));
            }
            candidates.push(path.join(resolved.zipPath, stage, name));
            if (stage === 'ps' && (resolved.zipName === 'shaders-300-de' || resolved.zipName === 'shaders-ptr-de')) {
                candidates.push(path.join(resolved.zipPath, name));
            }
        }

        if (!resolved.zipName.startsWith('shaders-ptr-') && !resolved.zipName.startsWith('shaders-300-')) {
            for (const root of getKnownShaderResourceRoots(quenchingDir)) {
                if (root.targetPrefix === stage) candidates.push(path.join(root.source, name));
                else if (!root.targetPrefix) candidates.push(path.join(root.source, stage, name));
            }
        }
        return [...new Set(candidates)];
    };

    let copied = 0;
    for (const key of files) {
        const source = candidatesFor(key).find(candidate => fs.existsSync(candidate));
        if (!source) continue; // Older packs can omit optional stages or effects.
        const target = path.join(outputDir, key);
        await fs.ensureDir(path.dirname(target));
        await fs.copy(source, target, { overwrite: true });
        copied++;
    }
    return copied;
}

async function installShaderFiles(
    war3Path: string,
    resolved: ResolvedShaderSource,
    files: string[],
): Promise<void> {
    const baseDir = await resolveShadersBaseDir(war3Path);
    const shadersDir = path.join(baseDir, 'shaders');
    const staging = await fs.mkdtemp(path.join(baseDir, '.quenching-shader-effect-'));
    try {
        const copied = await stageProfileShaderFiles(resolved, files, staging);
        if (copied === 0) throw new Error(`当前着色器配置没有可用的资源文件: ${files.join(', ')}`);
        await fs.ensureDir(shadersDir);
        for (const file of files) {
            const source = path.join(staging, file);
            if (await fs.pathExists(source)) await copyBundledResourceIfChanged(source, path.join(shadersDir, file));
        }
    } finally {
        await rm(staging, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
    }
}

async function removeShaderFiles(war3Path: string, files: string[]): Promise<void> {
    const baseDir = await resolveShadersBaseDir(war3Path);
    const shadersDir = path.join(baseDir, 'shaders');
    for (const file of files) {
        await fs.remove(path.join(shadersDir, file));
    }
}

export function registerShaderHandlers() {
    console.log('[Shader] Shader handlers registered.');

    ipcMain.handle('war3:detect-version', async (_event, war3Path?: string) => {
        const target = war3Path || configManager.get('war3Path');
        return detectWar3Version(target);
    });

    ipcMain.handle('shader:sync-versioned', async (_event, war3Path?: string) => {
        const target = war3Path || configManager.get('war3Path');
        if (!target || !getChannelModEnabled(getSelectedGameChannel()) ||
            await isThirdPartyQuenchingPaused(target) || !(await isFullPackageInstalled(target))) {
            return { success: false };
        }
        return ensureVersionedShaders(target);
    });

    ipcMain.handle('shader:update-object-shader', async (_event, war3Path: string, enabled: boolean) => {
        console.log(`[Shader] Updating object shader: ${enabled}`);

        await applyCurrentShaderToggles(war3Path, { objectShader: enabled }, enabled ? OBJECT_SHADER_FILES : []);
        return true;
    });

    ipcMain.handle('shader:update-post-processing', async (_event, war3Path: string, enabled: boolean) => {
        console.log(`[Shader] Updating post-processing shadows: ${enabled}`);

        await applyCurrentShaderToggles(war3Path, { postProcessing: enabled }, enabled ? POST_PROCESSING_SHADOW_FILES : []);
        return true;
    });

    ipcMain.handle('shader:update-post-processing-outline', async (_event, war3Path: string, enabled: boolean) => {
        await applyCurrentShaderToggles(war3Path, { postProcessingOutline: enabled === true });
        return true;
    });

    ipcMain.handle('shader:update-hdr', async (_event, war3Path: string, enabled: boolean) => {
        if (typeof enabled !== 'boolean') throw new Error('Invalid HDR setting');
        if (!getChannelModEnabled(getSelectedGameChannel())) return true;
        const { profile } = await resolveCurrentShaderProfile(war3Path);
        if (enabled && !supportsHdr(profile)) throw new Error('HDR tone mapping is unavailable for this game version');
        if (enabled) await applyCurrentShaderToggles(war3Path, { hdr: true }, HDR_SHADER_FILES);
        else await removeShaderFiles(war3Path, HDR_SHADER_FILES);
        await AssetSyncService.ensurePostProcessingConfig(war3Path, undefined, enabled);
        return true;
    });

    ipcMain.handle('shader:update-post-processing-glow', async (_event, war3Path: string, enabled: boolean) => {
        console.log(`[Shader] Updating post-processing glow: ${enabled}`);

        if (enabled) {
            await applyCurrentShaderToggles(war3Path, { postProcessingGlow: true }, POST_PROCESSING_GLOW_FILES);
            return true;
        }

        await resolveCurrentShaderProfile(war3Path);
        await removeShaderFiles(war3Path, POST_PROCESSING_GLOW_FILES);
        await AssetSyncService.ensurePostProcessingConfig(war3Path, undefined, undefined, false);
        return true;
    });

    // Kept for API compatibility; ignores `enabled` and always auto-selects by War3 version.
    ipcMain.handle('shader:update-legacy-war3', async (_event, war3Path: string, _enabled?: boolean) => {
        console.log('[Shader] sync versioned shaders (auto from War3 version)');
        return applyLegacyShaderVersion(war3Path);
    });

    ipcMain.handle('shader:update-readability', async (_event, war3Path: string, enabled: boolean) => {
        await applyCurrentShaderToggles(war3Path, { improveReadability: enabled === true });
        return true;
    });
}

/** Startup: ensure correct pack, then strip toggled-off shader files. */
export async function cleanupShadersOnStartup(war3Path: string, modSettings: any) {
    await ensureVersionedShaders(war3Path);

    if (modSettings.objectShader === false) {
        console.log('[Shader] Cleaning up object shaders on startup');
        await removeShaderFiles(war3Path, OBJECT_SHADER_FILES);
    }

    if (modSettings.postProcessing === false) {
        console.log('[Shader] Cleaning up post-processing shadow shaders on startup');
        await removeShaderFiles(war3Path, POST_PROCESSING_SHADOW_FILES);
    }
    if (modSettings.postProcessingGlow === false) {
        console.log('[Shader] Cleaning up post-processing glow shaders on startup');
        await removeShaderFiles(war3Path, POST_PROCESSING_GLOW_FILES);
    }
    if (modSettings.hdr === false) await removeShaderFiles(war3Path, HDR_SHADER_FILES);
    if (modSettings.postProcessing !== false) {
        await applyCurrentShaderToggles(war3Path);
    }
    await AssetSyncService.ensurePostProcessingConfig(war3Path, undefined,
        modSettings.hdr ?? modSettings.postProcessing !== false);
}
