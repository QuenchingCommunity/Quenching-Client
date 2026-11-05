import { resourceArchiveExists } from './bundled-packages';
import { getSelectedGameChannel, getChannelModEnabled, hasGameChannelDirectory } from './game-channel';
import fs from 'fs-extra';
import path from 'path';
import { extractZipArchive } from './zip-extraction';
import { rm } from 'node:fs/promises';
import { app } from 'electron';
import { configManager } from './config-manager';
import { isFullPackageInstalled, resolveRetailDir } from './full-package-service';
import { effectiveLightingMode, getDncResourcePath, getKnownDncRoots, getQuenchingResourcePath, getShaderPackRoot, getShaderResourcePath, resolveModProfile } from './mod-profile';
import { ModProfile, isHdShaderPack, isVersion30OrLater, assertShaderProfileSupported } from '../../shared/mod-profile';
import { withShaderBundle, selectShaderBundleResources } from './shader-bundle';
import { prepareBundledAssets, ensureResourceSelection } from './bundled-assets';
import { UNPACKED_RESOURCE_DIRS } from '../../shared/bundled-resource-paths.mjs';
import { applyDncLighting } from './dnc-lighting';
import { patchRotatingUnitLighting } from './rotating-lighting';
import { withResourceDirectory } from './resource-directory-queue';
import { applyShaderToggles, supportsHdr } from './fog-shader-override';
import { isThirdPartyQuenchingPaused, markKnownQuenching } from './third-party-resources';
import { BundledResourceRoot, createResourceSourceCache, syncBundledResourceFiles } from './managed-resource-files';
import { getInstalledModState } from './mod-update-service';
import { readCurrentModVersion } from './mod-integrity-service';
import { refreshUnitSkinBaseline, skinEraForVersion, skinProfileForGraphics, switchUnitSkinProfile, syncUnitSkinBattleMode, unitSkinTemplate } from './unit-skin-profile';
import { destructableSkinTemplate } from './destructable-skin-profile';
import { syncClientWebUIFiles } from './webui-assets-service';
import { copyPostProcessingConfigIfMissing, POST_PROCESSING_CONFIG_FILE, setPostProcessingAoEnabled, setPostProcessingTonemapEnabled, setPostProcessingBloomEnabled } from './post-processing-config';
import { gameChannelFolder } from '../../shared/game-channel';
import { normalizeWar3RootPath } from './war3-path';
import { isShaderDirectoryLock, renameShaderDirectory, replaceLockedShaderFiles } from './shader-directory';
import { createSettingsProgressReporter, SettingsProgress } from '../../shared/settings-progress';
import { syncAtmosphericLight } from './atmospheric-light';
import { resourceCacheLocation } from './resource-cache-location';

const PROFILE_ENV_MARKER = '.quenching-public-environment';
const PROFILE_SHADER_MARKER = '.quenching-shader-profile';
const PROFILE_DNC_MARKER = '.quenching-dnc-profile';

async function writeProfileMarker(dir: string, name: string): Promise<void> {
  await fs.ensureDir(dir);
  await fs.writeFile(path.join(dir, name), `${new Date().toISOString()}\n`, 'utf8');
}

export function getKnownShaderResourceRoots(quenchingDir: string): BundledResourceRoot[] {
  const hd = getQuenchingResourcePath(quenchingDir, 'shaders300Hd');
  const ptrHd = getQuenchingResourcePath(quenchingDir, 'shadersPtrHd');
  return [
    { source: getQuenchingResourcePath(quenchingDir, 'shaders203') },
    { source: getQuenchingResourcePath(quenchingDir, 'shaders300De') },
    { source: getQuenchingResourcePath(quenchingDir, 'shadersPtrDe') },
    { source: path.join(hd, 'vs'), targetPrefix: 'vs' },
    ...['standard', 'melee', 'rpg'].map(name => ({ source: path.join(hd, 'ps', name), targetPrefix: 'ps' })),
    { source: path.join(ptrHd, 'vs'), targetPrefix: 'vs' },
    ...['standard', 'melee', 'rpg'].map(name => ({ source: path.join(ptrHd, 'ps', name), targetPrefix: 'ps' })),
  ];
}

function lightingResourceSources(quenchingDir: string, profile: ModProfile, lighting: string, shaderQuenchingDir = quenchingDir): Array<[string, string]> {
  return [
    ['DNC', getDncResourcePath(quenchingDir, profile)],
    ['shader', getShaderResourcePath(shaderQuenchingDir, profile, lighting)],
    ...(isHdShaderPack(profile.shaderPack) || ['shaders-300-de', 'shaders-ptr-de'].includes(profile.shaderPack)
      ? [['shader VS', path.join(getShaderPackRoot(shaderQuenchingDir, profile), 'vs')] as [string, string]]
      : []),
  ];
}

/** AO is on for DE standard and RPG; DE battle and every non-DE profile run without it. */
function postProcessingAoFor(profile: ModProfile, lighting: unknown): boolean {
  return profile.graphics === 'de' && lighting !== 'battle';
}

/** Compose public environment and selected foliage for profiles that use it. */
async function syncPublicEnvironment(retailDir: string, quenchingDir: string, profile: ModProfile, modSettings: Record<string, unknown>, force = false, onProgress?: (percent: number) => void): Promise<void> {
  onProgress?.(0);
  const environmentDir = path.join(retailDir, 'environment');
  const environmentMarker = path.join(environmentDir, PROFILE_ENV_MARKER);
  if (!profile.usesPublicEnvironment) {
    // Park the HD environment; these folders can also contain player files.
    const { parkHdPublicEnvironment } = await import('./environment-layout-service');
    await parkHdPublicEnvironment(retailDir);
    await fs.remove(environmentMarker);
    onProgress?.(100);
    return;
  }

  const { restoreHdPublicEnvironment } = await import('./environment-layout-service');
  const restored = await restoreHdPublicEnvironment(retailDir);
  let refreshed = restored;
  const environmentZip = getQuenchingResourcePath(quenchingDir, 'environmentPublic');
  if (restored && !force) {
    // Recompose restored foliage below: its parked variant may predate the saved settings.
  } else if (!(await resourceArchiveExists(environmentZip))) {
    if (force) throw new Error(`Public environment package not found: ${environmentZip}`);
    console.warn(`[AssetSync] Public environment package not found: ${environmentZip}`);
  } else if (force || !(await fs.pathExists(environmentMarker))) {
    const staging = await fs.mkdtemp(path.join(retailDir, '.quenching-public-environment-'));
    try {
      await AssetSyncService.extractZip(environmentZip, staging, percent => onProgress?.(percent * 0.45));
      // Foliage has its own terrain-specific ZIP profile. Installing the
      // public environment ZIP's foliage here would overwrite that choice.
      const publicRoots = ['environmentmap', 'sky'].map(name => ({
        source: path.join(staging, name), targetPrefix: name,
      }));
      await syncBundledResourceFiles(environmentDir, publicRoots, publicRoots, '.quenching-public-environment-files', {
        removeAbsent: false,
        onProgress: (done, total) => onProgress?.(45 + (total ? done / total : 1) * 18),
      });
      refreshed = true;
    } finally {
      await rm(staging, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
    }
  }
  if (refreshed || await fs.pathExists(environmentMarker)) {
    const { syncPublicEnvironmentFoliage } = await import('./foliage-service');
    await syncPublicEnvironmentFoliage(retailDir, quenchingDir, modSettings, refreshed,
      percent => onProgress?.(65 + percent * 0.35));
    // The marker represents the complete composition, including selected foliage.
    if (refreshed) await writeProfileMarker(environmentDir, PROFILE_ENV_MARKER);
  }
  onProgress?.(100);
}

/** Public env, shaders and DNC for the profile and lighting mode, with the DNC lighting/brightness patch applied. */
export async function syncLightingResources(
  war3Path: string,
  quenchingDir: string,
  modSettings: any,
  resolvedProfile?: ModProfile,
  options: { forceEnvironment?: boolean; onProgress?: SettingsProgress } = {},
): Promise<void> {
  const report = createSettingsProgressReporter(options.onProgress);
  report('sync-start', 12);
  if (!getChannelModEnabled(getSelectedGameChannel())) return;
  const lighting = modSettings?.lighting || 'standard';
  const profile = resolvedProfile ?? await resolveModProfile(war3Path, {
    versionSelection: modSettings?.versionSelection,
    graphicsSelection: modSettings?.graphicsSelection,
    classicMode: modSettings?.classicMode === true,
    lighting,
  });
  if (profile.graphics === 'sd') return;
  assertShaderProfileSupported(profile);
  await ensureResourceSelection(quenchingDir, ['dnc', 'skin']);
  const retailDir = await resolveRetailDir(war3Path);
  return withShaderBundle(quenchingDir, profile.shaderPack, retailDir, async shaderQuenchingDir => {
  report('shaders', 35);
  for (const [label, source] of lightingResourceSources(quenchingDir, profile, lighting, shaderQuenchingDir)) {
    if (!(await fs.pathExists(source))) {
      throw new Error(`Missing ${label} resource for ${profile.version}/${profile.graphics}: ${source}`);
    }
  }
  if (options.forceEnvironment && profile.usesPublicEnvironment &&
      !await resourceArchiveExists(getQuenchingResourcePath(quenchingDir, 'environmentPublic'))) {
    throw new Error('Public environment package is missing');
  }
  const dncDir = path.join(retailDir, 'environment', 'dnc');
  const shadersDir = path.join(retailDir, 'shaders');
  const shaderSource = getShaderResourcePath(shaderQuenchingDir, profile, lighting);
  const sourceCache = createResourceSourceCache();
  const existing = await fs.lstat(shadersDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Shader target is not an ordinary directory');

  const desiredShaderRoots = isHdShaderPack(profile.shaderPack) || ['shaders-300-de', 'shaders-ptr-de'].includes(profile.shaderPack)
    ? [
        { source: path.join(getShaderPackRoot(shaderQuenchingDir, profile), 'vs'), targetPrefix: 'vs' },
        { source: isHdShaderPack(profile.shaderPack) ? shaderSource : path.join(shaderSource, 'ps'), targetPrefix: 'ps' },
      ]
    : [{ source: shaderSource }];
  // Build first; invalid inputs must not erase the working shader directory.
  const staging = await fs.mkdtemp(path.join(retailDir, '.quenching-rendering-'));
  const prepared = path.join(staging, 'shaders');
  const previous = path.join(staging, 'previous-shaders');
  let preserveBackup = false;
  try {
    await syncBundledResourceFiles(prepared, desiredShaderRoots, [], PROFILE_SHADER_MARKER, {
      sourceCache, removeAbsent: false,
      onProgress: (done, total) => report('shaders', 35 + (total ? done / total : 1) * 25),
    });
    await fs.writeFile(path.join(prepared, '.quenching-shader-pack'), `${profile.shaderPack}\n`, 'utf8');
    await applyShaderToggles(prepared, shaderQuenchingDir, profile, modSettings);
    report('environment', 65);
    await syncPublicEnvironment(retailDir, quenchingDir, profile, modSettings, options.forceEnvironment,
      percent => report('environment', 65 + percent * 0.07));
    await withResourceDirectory(dncDir, async () => {
      await syncBundledResourceFiles(dncDir, [{ source: getDncResourcePath(quenchingDir, profile) }], getKnownDncRoots(quenchingDir), PROFILE_DNC_MARKER, {
        sourceCache, onProgress: (done, total) => report('dnc', 72 + (total ? done / total : 1) * 8),
      });
      await applyDncLighting(dncDir, effectiveLightingMode(profile, lighting), modSettings?.lightingBrightness, {
        deMode: profile.graphics === 'de', isVersion30: isVersion30OrLater(profile.version), unitLightAngle: modSettings?.lightingAngle,
      }, (done, total) => report('dnc', 80 + (total ? done / total : 1) * 8));
      if (modSettings?.rotatingLighting === true) {
        await patchRotatingUnitLighting(dncDir, getDncResourcePath(quenchingDir, profile), true,
          effectiveLightingMode(profile, lighting), modSettings?.lightingBrightness, {
            deMode: profile.graphics === 'de', isVersion30: isVersion30OrLater(profile.version), unitLightAngle: modSettings?.lightingAngle,
          });
      }
    });
    await AssetSyncService.ensurePostProcessingConfig(war3Path, postProcessingAoFor(profile, lighting),
      supportsHdr(profile) && (modSettings?.hdr ?? modSettings?.postProcessing !== false));
    report('shaders', 90);
    let replacedInPlace = false;
    if (existing) {
      try { await renameShaderDirectory(shadersDir, previous); }
      catch (error) {
        if (!isShaderDirectoryLock(error)) throw error;
        console.warn('[AssetSync] Shader directory cannot be moved; updating individual files with rollback protection.');
        await replaceLockedShaderFiles(shadersDir, prepared, previous, () => { preserveBackup = true; });
        replacedInPlace = true;
      }
    }
    try { if (!replacedInPlace) await renameShaderDirectory(prepared, shadersDir); }
    catch (error) {
      if (existing) {
        try { await renameShaderDirectory(previous, shadersDir); }
        catch (restoreError) {
          preserveBackup = true;
          console.error(`[AssetSync] Shader backup retained in ${previous}`, restoreError);
        }
      }
      throw error;
    }
    report('finish', 95);
  } finally {
    if (!preserveBackup) await rm(staging, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
  report('layout', 96);
  await syncUnitSkinBattleMode(retailDir, skinProfileForGraphics(profile.graphics,
    configManager.get('retroSkinUnits') === true, configManager.get('retroSkinBuildings') === true),
    skinEraForVersion(profile.version), { ...modSettings, resolvedVersion: profile.version });
  report('finish', 99);
  console.log(`[AssetSync] Lighting resources: ${profile.shaderPack} + ${profile.dncPack} (${lighting})`);
  }, selectShaderBundleResources(profile, modSettings), percent => report('shaders', 12 + percent * 0.23));
}

export async function syncProfileResources(
  war3Path: string,
  quenchingDir: string,
  modSettings: any,
  onProgress?: (step: string, percent: number) => void,
): Promise<void> {
  const lighting = modSettings?.lighting || 'standard';
  const profile = await resolveModProfile(war3Path, {
    versionSelection: modSettings?.versionSelection,
    graphicsSelection: modSettings?.graphicsSelection,
    classicMode: modSettings?.classicMode === true,
    lighting,
  });
  assertShaderProfileSupported(profile);
  const retailDir = await resolveRetailDir(war3Path);
  const skinProfile = skinProfileForGraphics(profile.graphics,
    configManager.get('retroSkinUnits') === true, configManager.get('retroSkinBuildings') === true);
  const skinEra = skinEraForVersion(profile.version);
  const skinOnly = profile.graphics === 'sd';
  await ensureResourceSelection(quenchingDir, ['skin', ...(!skinOnly ? ['dnc'] : [])]);
  if (!skinOnly) await withShaderBundle(quenchingDir, profile.shaderPack, retailDir, async () => {}, selectShaderBundleResources(profile, modSettings));

  // A Home profile change must not be reported as successful when its pack is
  // absent. Check before replacing the active profile resources.
  for (const [label, source] of [
    ...(skinOnly ? [] : lightingResourceSources(quenchingDir, profile, lighting)),
    ...(!skinOnly
      ? [['destructable skin', destructableSkinTemplate(quenchingDir, profile.graphics, profile.version, modSettings?.tree || 'original')]]
      : []),
    ['unit skin', unitSkinTemplate(quenchingDir, skinProfile, skinEra)],
  ]) {
    if (!(await fs.pathExists(source))) {
      throw new Error(`Missing ${label} resource for ${profile.version}/${profile.graphics}: ${source}`);
    }
  }

  console.log(`[AssetSync] Applying profile ${profile.version}/${profile.graphics} (${profile.shaderPack}, ${profile.dncPack})`);

  // Restore parked resources before the HD/DE profile writes its new shaders
  // and environment. SD instead keeps only the selected skin table active.
  const { parkNonHdUnitsAndBuildings, restoreHdUnitsAndBuildings, restoreSdParkedResources, syncGraphicsLayout } = await import('./graphics-layout-service');
  if (!skinOnly) await restoreSdParkedResources(war3Path);
  if (profile.graphics === 'hd') await restoreHdUnitsAndBuildings(war3Path);
  else if (!skinOnly) await parkNonHdUnitsAndBuildings(war3Path);
  const selections = (configManager.get('skinSelections') || {})[path.resolve(war3Path).toLowerCase()] || {};
  const skinSwitch = await switchUnitSkinProfile(retailDir, quenchingDir, skinProfile, skinEra, { selections });
  if (skinProfile === 'hd-retro' && skinSwitch.created) {
    const { retroSkinService } = await import('./retro-skin-service');
    await retroSkinService.apply({
      unitsEnabled: configManager.get('retroSkinUnits') === true,
      buildingsEnabled: configManager.get('retroSkinBuildings') === true,
    });
  }
  if (skinOnly) {
    onProgress?.('layout', 80);
    await syncGraphicsLayout(war3Path, 'sd');
    configManager.set('modSettings', {
      ...modSettings,
      versionSelection: profile.versionSelection,
      graphicsSelection: profile.graphicsSelection,
      resolvedVersion: profile.version,
      resolvedGraphics: profile.graphics,
    });
    return;
  }
  onProgress?.('environment', 30);
  await syncLightingResources(war3Path, quenchingDir, modSettings, profile, {
    onProgress: (step, percent) => onProgress?.(step, 30 + percent * 0.4),
  });

  // Rebuild from this version's table while retaining the player's tree choice.
  // This also replaces tables left by older clients on startup/package install.
  onProgress?.('skin', 72);
  const { applyTreeSettings } = await import('../ipc/tree-handlers');
  await applyTreeSettings(war3Path, modSettings?.tree || 'original', profile, quenchingDir);

  onProgress?.('layout', 80);
  const layout = await syncGraphicsLayout(war3Path, profile.graphics, {
    classicMode: modSettings?.classicMode === true,
    waterMode: modSettings?.water,
  });

  if (layout.waterNeedsReapply && modSettings?.water) {
    onProgress?.('layout-water', 84);
    const { applyWaterSettings } = await import('../ipc/water-handlers');
    await applyWaterSettings(war3Path, modSettings.water);
  }

  // Record the resolved profile only after every requested resource switch succeeds.
  configManager.set('modSettings', {
    ...modSettings,
    versionSelection: profile.versionSelection,
    graphicsSelection: profile.graphicsSelection,
    resolvedVersion: profile.version,
    resolvedGraphics: profile.graphics,
  });
}

export class AssetSyncService {
  /** Called after the renderer's first paint; never awaited by window creation. */
  static async prepareStartupAssets(notify: (progress: { firstRun: boolean; percent: number }) => void,
    onClientReady?:()=>void|Promise<void>): Promise<void> {
    const assets=await this.getAssetsDir();
    await onClientReady?.();
    const developmentSources=!app.isPackaged && (await Promise.all(UNPACKED_RESOURCE_DIRS.map(dir=>fs.pathExists(path.join(assets,'unpacked',dir))))).every(Boolean);
    if(developmentSources)return;
    let firstRun=false;
    await prepareBundledAssets(assets,{
      ...resourceCacheLocation(app.isPackaged,app.getPath('exe'),assets),required:app.isPackaged,
      startup:true,
      onPreparation:first=>{firstRun=first;notify({firstRun,percent:0});},
      onProgress:percent=>notify({firstRun,percent}),
    });
  }
  static async getAssetsDir(resources: string[] = []): Promise<string> {
    const appPath = app.getAppPath();
    const resourcesPath = (process as any).resourcesPath as string | undefined;
    const candidates = [
      resourcesPath ? path.join(resourcesPath, 'assets') : '',
      path.join(process.cwd(), 'assets'),
      path.join(process.cwd(), 'public', 'assets'),
      path.join(process.cwd(), 'QuenChing-Electron-Client', 'assets'),
      path.join(process.cwd(), 'projects', 'QuenChing-Mod-Client', 'assets'),
      path.join(appPath, 'assets'),
      path.join(path.dirname(appPath), 'assets'),
      path.join(appPath, 'projects', 'QuenChing-Mod-Client', 'assets'),
    ].filter(Boolean).map(p => path.normalize(p));

    const uniqueCandidates = app.isPackaged
      ? (resourcesPath ? [path.join(resourcesPath, 'assets')] : [])
      : Array.from(new Set(candidates));
    for (const p of uniqueCandidates) {
      if ((await fs.stat(p).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
        throw error;
      }))?.isDirectory()) {
        const developmentSources = !app.isPackaged && (await Promise.all(UNPACKED_RESOURCE_DIRS.map(dir => fs.pathExists(path.join(p, 'unpacked', dir))))).every(Boolean);
        if (!developmentSources && (app.isPackaged || await fs.pathExists(path.join(p, 'quenching', 'resources.manifest.json')))) {
          await prepareBundledAssets(p, { ...resourceCacheLocation(app.isPackaged,app.getPath('exe'),p), required: app.isPackaged, selections: resources });
        }
        return p;
      }
    }

    throw new Error(`Client assets directory not found (searched ${uniqueCandidates.length} locations)`);
  }

  static async extractZip(
    zipPath: string,
    extractPath: string,
    onProgress?: (percent: number, currentFile: string) => void,
    options?: { stripLeadingDirectory?: string | string[] }
  ): Promise<number> {
    return extractZipArchive(zipPath, extractPath, {
      ...options,
      onProgress,
    });
  }

  /** Synchronize client-owned WebUI files independently of graphics/profile settings. */
  static async syncClientWebUIAssets(war3Path: string): Promise<boolean> {
    const settings = configManager.get('modSettings');
    if (settings?.graphicsSelection === 'sd' || settings?.classicMode === true) return false;
    if (await isThirdPartyQuenchingPaused(war3Path)) {
      console.log('[AssetSync] Third-party support has parked Quenching resources; skipping WebUI sync.');
      return false;
    }
    if (!getChannelModEnabled(getSelectedGameChannel())) {
      console.log('[AssetSync] MOD is disabled for this branch. Skipping WebUI sync.');
      return false;
    }
    if (!(await isFullPackageInstalled(war3Path))) {
      console.log('[AssetSync] No complete package for this branch. Skipping WebUI sync.');
      return false;
    }

    const assetsDir = await this.getAssetsDir(['tx']);
    const quenchingDir = path.join(assetsDir, 'quenching');
    const targetWebUIDir = path.join(await resolveRetailDir(war3Path), 'webui');
    const language = configManager.get('language') || 'zh-CN';
    await syncClientWebUIFiles(targetWebUIDir, quenchingDir, language);
    console.log(`[AssetSync] Updated WebUI assets for ${language}`);
    return true;
  }

  /**
   * Basic client file. When the selected branch's MOD switch is on, install
   * PostProcessingConfig.txt if that branch does not already have one.
   * The other branch stays vanilla. An existing file keeps its values except
   * AO and Tonemap, which follow the selected profile/settings. A full package is not required.
   */
  static async ensurePostProcessingConfig(war3Path: string, aoEnabled?: boolean, hdrEnabled?: boolean, glowEnabled?: boolean): Promise<void> {
    const root = normalizeWar3RootPath(war3Path);
    if (!root) return;
    const settings = configManager.get('modSettings');
    if (settings?.graphicsSelection === 'sd' || settings?.classicMode === true) return;

    const source = path.join(await this.getAssetsDir(), 'quenching', POST_PROCESSING_CONFIG_FILE);
    if (!(await fs.pathExists(source))) {
      throw new Error(`PostProcessingConfig source missing: ${source}`);
    }

    const channel = getSelectedGameChannel();
    if (!getChannelModEnabled(channel)) return;
    if (!(await hasGameChannelDirectory(root, channel))) return;
    const profile = await resolveModProfile(root, settings || {});
    assertShaderProfileSupported(profile);
    const buildDir = path.join(root, gameChannelFolder(channel));
    const copied = await copyPostProcessingConfigIfMissing(buildDir, source);
    if (copied) console.log(`[AssetSync] Installed ${POST_PROCESSING_CONFIG_FILE} into ${gameChannelFolder(channel)}`);

    let ao = aoEnabled;
    if (ao === undefined) {
      ao = postProcessingAoFor(profile, settings?.lighting || 'standard');
    }
    if (await setPostProcessingAoEnabled(buildDir, ao)) {
      console.log(`[AssetSync] ${POST_PROCESSING_CONFIG_FILE}: AO ${ao ? 'enabled' : 'disabled'}`);
    }
    await setPostProcessingTonemapEnabled(buildDir, supportsHdr(profile) &&
      (hdrEnabled ?? settings?.hdr ?? settings?.postProcessing !== false));
    const bloom = glowEnabled ?? settings?.postProcessingGlow !== false;
    await setPostProcessingBloomEnabled(buildDir, bloom);
  }

  /** Replace unitskin files built from an older bundled baseline (startup, and forced after a package install). */
  static async refreshUnitSkinBaseline(war3Path: string, options: { force?: boolean } = {}): Promise<void> {
    if (!getChannelModEnabled(getSelectedGameChannel())) return;
    if (await isThirdPartyQuenchingPaused(war3Path)) return;
    if (!(await isFullPackageInstalled(war3Path))) return;
    const modSettings = configManager.get('modSettings') || {};
    const profile = await resolveModProfile(war3Path, {
      versionSelection: modSettings.versionSelection,
      graphicsSelection: modSettings.graphicsSelection,
      classicMode: modSettings.classicMode === true,
      lighting: modSettings.lighting,
    });
    const retroUnits = configManager.get('retroSkinUnits') === true;
    const retroBuildings = configManager.get('retroSkinBuildings') === true;
    const result = await refreshUnitSkinBaseline(
      await resolveRetailDir(war3Path),
      path.join(await this.getAssetsDir(['skin']), 'quenching'),
      skinProfileForGraphics(profile.graphics, retroUnits, retroBuildings),
      skinEraForVersion(profile.version),
      { ...options, selections: (configManager.get('skinSelections') || {})[path.resolve(war3Path).toLowerCase()] || {} },
    );
    if (result.refreshed && result.profile === 'hd-retro') {
      const { retroSkinService } = await import('./retro-skin-service');
      await retroSkinService.apply({ unitsEnabled: retroUnits, buildingsEnabled: retroBuildings });
    }
    await syncUnitSkinBattleMode(await resolveRetailDir(war3Path), result.profile, result.era, { ...modSettings, resolvedVersion: profile.version });
  }

  static async syncConfiguredAssets(
    war3Path: string,
    onProgress?: (step: string, percent: number) => void,
    options: { forceUi?: boolean } = {},
  ): Promise<'applied' | 'third-party-paused' | 'mod-disabled' | 'legacy-package' | 'package-missing' | 'classic-mode'> {
    console.log('[AssetSync] Applying explicitly selected resource settings');
    console.log(`[AssetSync] Target War3 Path: ${war3Path}`);

    if (await isThirdPartyQuenchingPaused(war3Path)) {
      console.log('[AssetSync] Third-party support has parked Quenching resources; skipping automatic extraction.');
      return 'third-party-paused';
    }

    const modSettings = configManager.get('modSettings');
    const isModEnabled = getChannelModEnabled(getSelectedGameChannel());

    if (!isModEnabled) {
      console.log('[AssetSync] MOD is disabled for this branch. Skipping automatic resource changes.');
      return 'mod-disabled';
    }

    if (!(await readCurrentModVersion(war3Path)) && (await getInstalledModState(war3Path))?.sequence === 34) {
      console.log('[AssetSync] Legacy 3.4 package detected; leaving resources unchanged until its 3.5 patch is applied.');
      return 'legacy-package';
    }

    if (!(await isFullPackageInstalled(war3Path))) {
      console.log('[AssetSync] No complete package for this branch. Awaiting ZIP installation; leaving existing files untouched.');
      return 'package-missing';
    }

    // Validate before the first WebUI or resource write.
    await resolveModProfile(war3Path, modSettings || {});
    if (modSettings?.graphicsSelection !== 'sd' && modSettings?.classicMode !== true) {
      await this.syncClientWebUIAssets(war3Path);
    }

    console.log(`[AssetSync] Mod Enabled: ${isModEnabled}`);
    console.log(`[AssetSync] Classic Mode: ${modSettings?.classicMode === true}`);

    const assetsDir = await this.getAssetsDir();
    const quenchingDir = path.join(assetsDir, 'quenching');

    console.log(`[AssetSync] Checking core assets in ${war3Path}`);
    console.log(`[AssetSync] Source directory: ${quenchingDir}`);

    // New resource layout is profile-driven. It replaces the old root-level
    // zip assumptions while leaving the legacy loop below available for an
    // older installation whose new resources have not been deployed yet.
    await syncProfileResources(war3Path, quenchingDir, modSettings || {}, onProgress);
    const { UIService } = await import('./ui-service');
    await UIService.syncConfiguredUI(war3Path, options.forceUi === true);
    await syncAtmosphericLight(await resolveRetailDir(war3Path),quenchingDir,modSettings?.atmosphericLight===true);
    await markKnownQuenching(war3Path);

    // Profile resources above replace the unsafe legacy whole-directory ZIP loop.
    return 'applied';
  }
}
