import {resolveHdrExposure,validateHdrExposure,withHdrExposure} from '../../shared/hdr-exposure';
import {VISION_MODULES, visionBlocksSetting} from '../../shared/vision-modules';
import { useState, useEffect } from 'react';
import { reaction } from 'mobx';
import { reaxel, createReaxable } from 'reaxes';
import { EffectiveGraphics, EffectiveVersion, GraphicsSelection, VersionSelection, normalizeVersionSelection, normalizeGraphicsSelection } from '../../shared/mod-profile';
import { graphicsFromHdValue, hdValueForGraphics, patchWar3Preferences, warcraftPreferencesFolder } from '../../shared/war3-preferences';
import { createSettingsProgressReporter } from '../../shared/settings-progress';
import { supportedWar3Version } from '../../shared/war3-support';
import {resolveUnitLightSettings,unitLightModeDefaults,validateUnitShadowSetting,type UnitShadowSetting} from '../../shared/unit-light-settings';
import {validateUnitLightAngle} from '../../shared/dnc-rotation';

async function getSelectedGameBuildDir(war3Path: string): Promise<string> {
  const channel = await window.electronAPI?.getConfig('gameChannel');
  return `${war3Path}/${channel === 'ptr' ? '_ptr_' : '_retail_'}`;
}

// War3设置接口
export interface War3Settings {
  hd: boolean;           // 重制版模式
  detectedGraphics?: EffectiveGraphics | null;
  reswidth: number;      // 分辨率宽度
  resheight: number;     // 分辨率高度
  windowmode: number;    // 窗口模式 (0=全屏, 1=窗口, 2=无边框窗口)
  [key: string]: any;
}

// 相机设置接口
export interface CameraSettings {
  enabled: boolean;
  fieldOfView: number;   // 视野角度
  angleOfAttack: number; // 攻击角度
}

// MOD设置接口
export interface ModSettings {
  versionSelection: VersionSelection;
  graphicsSelection: GraphicsSelection;
  resolvedGraphics?: EffectiveGraphics; // Last successfully applied profile, not the current selection.
  resolvedVersion?: EffectiveVersion;
  objectShader: boolean; // 物体着色器
  postProcessing: boolean; // 后处理阴影
  postProcessingGlow: boolean; // 后处理辉光（两份 Bloom 和 Gaussian Blur）
  hdrExposure?: number;
  hdr: boolean; // 独立的色调映射开关
  postProcessingOutline: boolean; // 3.0.1+ 物体描边，AO 强度由光照模式决定
  volumetricFog: boolean; // 体积雾
  water: 'transparent' | 'realistic' | 'off'; // 水面效果
  foliage: boolean;      // 植被效果
  blight: boolean;       // 淬火腐蚀之地覆盖
  lighting: 'standard' | 'enhanced' | 'battle' | 'rpg'; // 光照效果
  /** 3.x：以3档为基准，主光每档15%，环境光每档0.015；2.04保留旧档位规则。 */
  lightingBrightness: 1 | 2 | 3 | 4 | 5;
  rotatingLighting: boolean; // 实验性：仅地表单位光照旋转，默认关闭
  atmosphericLight?: boolean;
  lightingAngle?: number|null; // null explicitly restores the source DNC direction.
  shadowLength: UnitShadowSetting;
  half: boolean;         // 半透明效果
  ui: 'classic' | 'quenching' | 'carnival'; // UI风格
  cam: boolean;          // 自定义相机
  glow: boolean;         // 英雄光晕弱光晕（true=弱, false=强）
  terrain: 'original' | 'latest' | 'retro' | 'v16' | 'v18' | 'decisive'; // 地形
  tree: 'original' | 'tall' | 'short' | 'retro' | 'v16' | 'v18'; // 树木
  visionUnits?: boolean;
  visionDecorations?: boolean;
  visionTerrain?: boolean;
  visionMisc?: boolean;
  modelEnhance: boolean; // 模型加强
  improveReadability: boolean; // 3.0.1 HD team-color effects and reversible unit scaling
  visionModPath: string; // VisionMod目录
  modEnabled: boolean;   // MOD总开关
  classicMode: boolean;  // 经典版锁定
}

export interface War3SettingsState {
  detectedVersion: EffectiveVersion | null;
  settings: War3Settings;
  cameraSettings: CameraSettings;
  modSettings: ModSettings;
  isLoading: boolean;
}

// War3设置管理
export const reaxel_War3Settings = reaxel(() => {
  const { store, setState } = createReaxable<War3SettingsState>({
    detectedVersion: null,
    settings: {} as War3Settings,
    cameraSettings: {
      enabled: false,
      fieldOfView: 70,
      angleOfAttack: 0
    } as CameraSettings,
    modSettings: {
      versionSelection: 'auto' as const,
      graphicsSelection: 'hd' as const,
      objectShader: true,
      postProcessing: true,
      postProcessingGlow: true,
      hdr: true,
      hdrExposure: 1.1,
      postProcessingOutline: false,
      volumetricFog: true,
      water: 'off' as const,
      foliage: true,
      blight: true,
      lighting: 'standard' as const,
      lightingBrightness: 3 as const,
      shadowLength: 50,
      rotatingLighting: false,
      atmosphericLight: false,
      half: false,
      ui: 'classic' as const,
      cam: false,
      glow: false,
      terrain: 'latest' as const,
      tree: 'tall' as const,
      modelEnhance: false,
      improveReadability: false,
      visionModPath: '',
      modEnabled: true
    } as ModSettings,
    isLoading: false
  });

  // 加载War3设置
  const loadSettings = async (war3Path: string) => {
    setState({ isLoading: true });

    try {
      // 读取War3Preferences.txt
      const docsPath = await window.electronAPI?.getAppPath('documents');
      const channel = await window.electronAPI?.getConfig('gameChannel');
      const preferencesPath = `${docsPath}/${warcraftPreferencesFolder(channel === 'ptr' ? 'ptr' : 'retail')}/War3Preferences.txt`;
      const exists = await window.electronAPI?.pathExists(preferencesPath);

      if (exists) {
        const content = await window.electronAPI?.readFile(preferencesPath);
        const settings = parseWar3Preferences(content);
        setState({ settings });
      }

      // 加载MOD设置
      await loadModSettings(war3Path);

    } catch (error) {
      console.error('Failed to load War3 settings:', error);
    } finally {
      setState({ isLoading: modSettingsSaving });
    }
  };

  // 解析War3Preferences.txt
  const parseWar3Preferences = (content: string): War3Settings => {
    const settings: War3Settings = {
      hd: false,
      detectedGraphics: null,
      reswidth: 1024,
      resheight: 768,
      windowmode: 0
    };

    const lines = content.split('\n');
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.includes('=')) {
        const [key, value] = trimmedLine.split('=').map(s => s.trim());

        switch (key) {
          case 'hd': {
            const detected = graphicsFromHdValue(value);
            settings.detectedGraphics = detected;
            settings.hd = detected !== null && detected !== 'sd';
            break;
          }
          case 'reswidth':
            settings.reswidth = parseInt(value) || 1024;
            break;
          case 'resheight':
            settings.resheight = parseInt(value) || 768;
            break;
          case 'windowmode':
            settings.windowmode = parseInt(value) || 0;
            break;
          default:
            settings[key] = value;
        }
      }
    }

    return settings;
  };

  /**
   * 基于文件是否存在检测英雄光晕 (heroglow_bw.dds)
   */
  const detectGlowMode = async (war3Path: string): Promise<boolean> => {
    try {
      const retailDir = await getSelectedGameBuildDir(war3Path);
      const baseDir = (await window.electronAPI?.pathExists(retailDir)) ? retailDir : war3Path;
      const targetPath = `${baseDir}/textures/fx/flare/heroglow_bw.dds`;
      return await window.electronAPI?.pathExists(targetPath);
    } catch (e) {
      console.warn('[useWar3Settings] detectGlowMode failed:', e);
      return store.modSettings.glow;
    }
  };

  // 保存War3设置
  const saveSettings = async (war3Path: string, newSettings: Partial<War3Settings>) => {
    try {
      const docsPath = await window.electronAPI?.getAppPath('documents');
      const channel = await window.electronAPI?.getConfig('gameChannel');
      const preferencesPath = `${docsPath}/${warcraftPreferencesFolder(channel === 'ptr' ? 'ptr' : 'retail')}/War3Preferences.txt`;
      if (!await window.electronAPI?.pathExists(preferencesPath)) {
        throw new Error('War3Preferences.txt 不存在，请先启动游戏生成设置文件');
      }
      const original = await window.electronAPI.readFile(preferencesPath);
      const content = patchWar3Preferences(original, newSettings);
      if (content !== original) {
        const backup = `${preferencesPath}.quenching-backup`;
        if (!await window.electronAPI.pathExists(backup)) await window.electronAPI.copyFile(preferencesPath, backup);
        await window.electronAPI.writeFile(preferencesPath, content);
      }
      setState({ settings: { ...store.settings, ...newSettings } });

    } catch (error) {
      console.error('Failed to save War3 settings:', error);
      throw error;
    }
  };

  // 切换游戏模式
  const toggleGameMode = async (war3Path: string, isReforged: boolean) => {
    await saveSettings(war3Path, { hd: isReforged });
  };

  // 设置分辨率
  const setResolution = async (war3Path: string, width: number, height: number) => {
    await saveSettings(war3Path, { reswidth: width, resheight: height });
  };

  // Resource synchronization resolves profiles in the main process. Refresh
  // only its result fields, retaining the renderer's preferences/detections.
  const readResolvedProfile = async (current: ModSettings): Promise<ModSettings> => {
    const persisted = await window.electronAPI?.getConfig?.('modSettings');
    if (!persisted || typeof persisted !== 'object' ||
      persisted.graphicsSelection !== current.graphicsSelection ||
      persisted.versionSelection !== current.versionSelection ||
      !!persisted.classicMode !== !!current.classicMode) return current;
    return {
      ...current,
      resolvedGraphics: persisted.resolvedGraphics,
      resolvedVersion: persisted.resolvedVersion,
    };
  };

  // 加载MOD设置
  let modSettingsLoadRequest = 0;
  let modSettingsSaving = false;
  const loadModSettings = async (war3Path: string) => {
    if (modSettingsSaving) return;
    const request = ++modSettingsLoadRequest;
    setState({ detectedVersion: null });
    console.log(`\n>>> [useWar3Settings] loadModSettings START for path: ${war3Path}`);
    try {
      let loadedSettings = { ...store.modSettings };
      let savedVisualSettings: Partial<ModSettings> | null = null;

      if (window.electronAPI?.getConfig) {
        const stored = await window.electronAPI.getConfig('modSettings');
        console.log('[useWar3Settings] Stored modSettings from config:', stored);
        if (stored && typeof stored === 'object') {
          savedVisualSettings = stored;
          loadedSettings = { ...loadedSettings, ...stored };
          loadedSettings.versionSelection = normalizeVersionSelection(loadedSettings.versionSelection);
          loadedSettings.graphicsSelection = normalizeGraphicsSelection(loadedSettings.graphicsSelection);

          // 迁移: 如果是旧的 'enhanced' (淬火) 模式，自动切换回 'standard' (普通)
          if (loadedSettings.lighting === 'enhanced') {
            loadedSettings.lighting = 'standard';
          }
          const lb = loadedSettings.lightingBrightness as number | undefined;
          if (typeof lb !== 'number' || lb < 1 || lb > 5 || !Number.isInteger(lb)) {
            loadedSettings.lightingBrightness = 3;
          }
        }
      }

      const selectedChannel = await window.electronAPI?.getConfig?.('gameChannel');
      const branchStates = await window.electronAPI?.getBranchModStates?.().catch(() => null);
      const branchEnabled = branchStates?.[selectedChannel === 'ptr' ? 'ptr' : 'retail']?.enabled ?? loadedSettings.modEnabled;
      console.log('[useWar3Settings] Starting file-based detection...');

      // 基于实际文件状态检测地形模式，高亮与真实状态一致
      const detectedTerrain = await detectTerrainMode(war3Path);
      console.log(`[useWar3Settings] Detected terrain: ${detectedTerrain}`);
      loadedSettings.terrain = detectedTerrain;
      loadedSettings.blight = loadedSettings.blight !== false;
      loadedSettings.rotatingLighting = loadedSettings.rotatingLighting === true;
      loadedSettings.atmosphericLight = loadedSettings.atmosphericLight === true;
      if (loadedSettings.lightingAngle!==null && (typeof loadedSettings.lightingAngle !== 'number' || !Number.isFinite(loadedSettings.lightingAngle) ||
          loadedSettings.lightingAngle < 0 || loadedSettings.lightingAngle > 360)) delete loadedSettings.lightingAngle;
      const unitLight=resolveUnitLightSettings({...loadedSettings,shadowLength:savedVisualSettings?.shadowLength});
      loadedSettings.shadowLength=savedVisualSettings?.shadowLength==='default'?'default':unitLight.unitShadowLength??50;
      if(loadedSettings.lightingAngle===undefined&&unitLight.unitLightAngle!==undefined)loadedSettings.lightingAngle=unitLight.unitLightAngle;

      // 检测树木模式
      const detectedTree = await detectTreeMode(war3Path);
      console.log(`[useWar3Settings] Detected tree: ${detectedTree}`);
      loadedSettings.tree = detectedTree;

      // 检测水面模式
      const detectedWater = await detectWaterMode(war3Path);
      console.log(`[useWar3Settings] Detected water: ${detectedWater}`);
      loadedSettings.water = detectedWater;

      // 检测植被模式
      // Shared folders and identity shaders can exist when an effect is off.
      // Saved Boolean preferences are authoritative; presence is only a
      // migration fallback for installations without a saved preference.
      const detectedFoliage = await detectFoliageMode(war3Path);
      console.log(`[useWar3Settings] Detected foliage: ${detectedFoliage}`);
      if (detectedTerrain === 'retro') {
        loadedSettings.foliage = false;
      } else loadedSettings.foliage = typeof savedVisualSettings?.foliage === 'boolean'
        ? savedVisualSettings.foliage : detectedFoliage;

      // 检测物体着色器
      const detectedObjectShader = await detectObjectShaderMode(war3Path);
      console.log(`[useWar3Settings] Detected objectShader: ${detectedObjectShader}`);
      loadedSettings.objectShader = typeof savedVisualSettings?.objectShader === 'boolean'
        ? savedVisualSettings.objectShader : detectedObjectShader;

      if (loadedSettings.postProcessingGlow === undefined) {
        loadedSettings.postProcessingGlow = loadedSettings.postProcessing !== false;
      }
      loadedSettings.hdrExposure=resolveHdrExposure({...loadedSettings,hdrExposure:savedVisualSettings?.hdrExposure});
      if (savedVisualSettings && typeof savedVisualSettings.hdr !== 'boolean') {
        loadedSettings.hdr = savedVisualSettings.postProcessing !== false;
      } else if (typeof loadedSettings.hdr !== 'boolean') loadedSettings.hdr = loadedSettings.postProcessing !== false;
      delete (loadedSettings as ModSettings & { useIntelAmdShaderFix?: boolean }).useIntelAmdShaderFix;
      if (loadedSettings.improveReadability === undefined) loadedSettings.improveReadability = false;
      if (loadedSettings.postProcessingOutline === undefined) loadedSettings.postProcessingOutline = false;

      // 检测后处理阴影和辉光
      const detectedPostProcessing = await detectPostProcessingMode(war3Path);
      console.log(`[useWar3Settings] Detected postProcessing: ${detectedPostProcessing}`);
      loadedSettings.postProcessing = typeof savedVisualSettings?.postProcessing === 'boolean'
        ? savedVisualSettings.postProcessing : detectedPostProcessing;
      const detectedPostProcessingGlow = await detectPostProcessingGlowMode(war3Path);
      console.log(`[useWar3Settings] Detected postProcessingGlow: ${detectedPostProcessingGlow}`);
      loadedSettings.postProcessingGlow = typeof savedVisualSettings?.postProcessingGlow === 'boolean'
        ? savedVisualSettings.postProcessingGlow : detectedPostProcessingGlow;

      // 检测英雄光晕
      const detectedGlow = await detectGlowMode(war3Path);
      console.log(`[useWar3Settings] Detected glow: ${detectedGlow}`);
      loadedSettings.glow = typeof savedVisualSettings?.glow === 'boolean'
        ? savedVisualSettings.glow : detectedGlow;

      // Loading settings is read-only. Startup, profile changes, and game launch
      // perform resource sync; opening the UI must not rewrite shader files.
      if (window.electronAPI?.detectWar3Version) {
        const versionInfo = await window.electronAPI.detectWar3Version(war3Path);
        console.log('[useWar3Settings] Detected War3 version:', versionInfo);
        if (request === modSettingsLoadRequest) {
          setState({ detectedVersion: versionInfo?.source && versionInfo.source !== 'unknown'
            ? supportedWar3Version(versionInfo.parts ?? (versionInfo.version || '').split('.').map(Number)) : null });
        }
      }

      // SD and the MOD switch park visual overrides. Keep saved preferences
      // rather than interpreting their absence as the player's next selection.
      if (!branchEnabled || loadedSettings.graphicsSelection === 'sd' || loadedSettings.classicMode) {
        if (savedVisualSettings) {
          for (const key of ['terrain', 'tree', 'water', 'foliage', 'objectShader',
            'postProcessing', 'postProcessingGlow', 'hdr', 'glow'] as const) {
            if (savedVisualSettings[key] !== undefined) (loadedSettings as any)[key] = savedVisualSettings[key];
          }
        }
      }

      console.log('[useWar3Settings] Final merged settings to be set in store:', loadedSettings);
      loadedSettings = await readResolvedProfile(loadedSettings);
      if (request !== modSettingsLoadRequest) return;
      setState({ modSettings: loadedSettings });

      // Detection is only for displaying the current file state. Persisting it
      // here can overwrite the player's saved preferences on every startup.
      await loadCameraSettings(war3Path);
      console.log('[useWar3Settings] loadModSettings COMPLETE\n');
    } catch (error) {
      console.error('[useWar3Settings] FATAL ERROR in loadModSettings:', error);
    }
  };

  /**
   * 基于文件内容检测树木模式
   */
  const detectTreeMode = async (war3Path: string): Promise<ModSettings['tree']> => {
    try {
      const retailDir = await getSelectedGameBuildDir(war3Path);
      const baseDir = (await window.electronAPI?.pathExists(retailDir)) ? retailDir : war3Path;
      const targetPath = `${baseDir}/units/destructableskin.txt`;
      const exists = await window.electronAPI?.pathExists(targetPath);

      console.log(`[useWar3Settings] Detecting tree mode at: ${targetPath}, exists: ${exists}`);
      if (!exists) return 'original';

      // 读取文件内容进行关键词匹配
      // @ts-ignore
      const content = await window.electronAPI.readFile(targetPath);
      if (!content) return 'original';

      const normalized = content.replace(/\\/g, '/').toLowerCase();

      if (normalized.includes('d20/lordaerontree-short')) return 'short';
      if (normalized.includes('tree/t18/') || normalized.includes('d18/')) return 'v18';
      if (normalized.includes('tree/t16/') || normalized.includes('d16/')) return 'v16';
      if (normalized.includes('d20/lordaerontree') || normalized.includes('tree/t20/')) return 'tall';
      if (normalized.includes('tree/t00')) return 'retro';

      return 'original';
    } catch (e) {
      console.warn('[useWar3Settings] detectTreeMode failed:', e);
      return store.modSettings.tree;
    }
  };

  /**
   * 基于文件内容检测水面模式
   */
  const detectWaterMode = async (war3Path: string): Promise<ModSettings['water']> => {
    try {
      const retailDir = await getSelectedGameBuildDir(war3Path);
      const baseDir = (await window.electronAPI?.pathExists(retailDir)) ? retailDir : war3Path;
      const shoreline = `${baseDir}/textures/shoreline1.dds`;
      const water = `${baseDir}/replaceabletextures/water`;
      const waterSlk = `${baseDir}/terrainart/water.slk`;
      if (await window.electronAPI?.pathExists(shoreline)) return 'transparent';
      if (await window.electronAPI?.pathExists(water) || await window.electronAPI?.pathExists(waterSlk)) return 'realistic';
      return 'off';
    } catch (e) {
      console.warn('[useWar3Settings] detectWaterMode failed:', e);
      return store.modSettings.water;
    }
  };

  /**
   * 基于目录是否存在检测植被模式
   */
  const detectFoliageMode = async (war3Path: string): Promise<boolean> => {
    try {
      const terrain = await detectTerrainMode(war3Path);
      if (terrain === 'retro') {
        return false;
      }

      const retailDir = await getSelectedGameBuildDir(war3Path);
      const baseDir = (await window.electronAPI?.pathExists(retailDir)) ? retailDir : war3Path;
      const foliageDir = `${baseDir}/environment/foliage`;
      const exists = await window.electronAPI?.pathExists(foliageDir);
      return !!exists;
    } catch (e) {
      console.warn('[useWar3Settings] detectFoliageMode failed:', e);
      return store.modSettings.foliage;
    }
  };

  /**
   * 基于文件是否存在检测物体着色器
   */
  const detectObjectShaderMode = async (war3Path: string): Promise<boolean> => {
    try {
      const retailDir = await getSelectedGameBuildDir(war3Path);
      const baseDir = (await window.electronAPI?.pathExists(retailDir)) ? retailDir : war3Path;
      const targetPath = `${baseDir}/shaders/ps/hd.bls`;
      return await window.electronAPI?.pathExists(targetPath);
    } catch (e) {
      console.warn('[useWar3Settings] detectObjectShaderMode failed:', e);
      return store.modSettings.objectShader;
    }
  };

  /**
   * 后处理阴影看体积雾文件。辉光关闭时 bloom 会被删掉，不能再用它判断阴影。
   */
  const detectPostProcessingMode = async (war3Path: string): Promise<boolean> => {
    try {
      const retailDir = await getSelectedGameBuildDir(war3Path);
      const baseDir = (await window.electronAPI?.pathExists(retailDir)) ? retailDir : war3Path;
      return !!await window.electronAPI?.pathExists(`${baseDir}/shaders/ps/fog.bls`);
    } catch (e) {
      console.warn('[useWar3Settings] detectPostProcessingMode failed:', e);
      return store.modSettings.postProcessing;
    }
  };

  /** 后处理辉光只看两份 Bloom 和 Gaussian Blur 是否还在。 */
  const detectPostProcessingGlowMode = async (war3Path: string): Promise<boolean> => {
    try {
      const retailDir = await getSelectedGameBuildDir(war3Path);
      const baseDir = (await window.electronAPI?.pathExists(retailDir)) ? retailDir : war3Path;
      return !!await window.electronAPI?.pathExists(`${baseDir}/shaders/ps/bloomextract.bls`);
    } catch (e) {
      console.warn('[useWar3Settings] detectPostProcessingGlowMode failed:', e);
      return store.modSettings.postProcessingGlow;
    }
  };

  // 保存MOD设置
  const requiresFullPackageChange = (newSettings: Partial<ModSettings>): boolean => {
    if (newSettings.terrain !== undefined && newSettings.terrain !== 'original') {
      return true;
    }
    if (newSettings.tree !== undefined && newSettings.tree !== 'original') {
      return true;
    }
    if (newSettings.water !== undefined) {
      return true;
    }
    return false;
  };

  const saveModSettings = async (
    war3Path: string,
    newSettings: Partial<ModSettings>,
    onProgress?: (step: string, percent: number) => void,
  ) => {
    newSettings=unitLightModeDefaults(newSettings);
    if (modSettingsSaving) throw new Error('设置正在应用，请稍候再试');
    modSettingsSaving = true;
    // A read started before this write must never restore its old snapshot.
    ++modSettingsLoadRequest;
    console.log('[useWar3Settings] saveModSettings called:', { war3Path, newSettings });
    const reportProgress = createSettingsProgressReporter(onProgress);
    // Keep the request pending until its worker really settles. A renderer-only
    // timeout cannot stop filesystem writes and must not roll back live work.
    const awaitResourceUpdate = async (
      operation: 'terrain' | 'foliage',
      invoke: (requestId: string) => Promise<boolean>,
      start: number,
      span: number,
    ) => {
      const requestId = crypto.randomUUID();
      const listener = (event: Event) => {
        const detail = (event as CustomEvent<{ operation?: string; requestId?: string; step: string; percent: number }>).detail;
        if (detail?.operation === operation && detail.requestId === requestId) {
          reportProgress(detail.step, start + detail.percent * span / 100);
        }
      };
      window.addEventListener('mod-profile-progress', listener);
      try {
        if (await invoke(requestId) === false) throw new Error(`${operation === 'terrain' ? '地形' : '植被'}设置未完成`);
      } finally { window.removeEventListener('mod-profile-progress', listener); }
    };
    let foliageAppliedByTerrain = false;
    let removeLightingProgress: (() => void) | undefined;
    let previousSettings = { ...store.modSettings };
    setState({ isLoading: true });

    // 强制等待 UI 渲染完成 (Hack: 利用事件循环机制)
    await new Promise(resolve => setTimeout(resolve, 0));

    try {
      if(newSettings.shadowLength!==undefined)validateUnitShadowSetting(newSettings.shadowLength);
      if(newSettings.lightingAngle!==undefined&&newSettings.lightingAngle!==null)validateUnitLightAngle(newSettings.lightingAngle);
      const module = VISION_MODULES.find(key => Object.hasOwn(newSettings,key));
      if(module){
        if(Object.keys(newSettings).length!==1)throw new Error('请逐项切换 Vision Mod 模块');
        const enabled=!!newSettings[module],source=store.modSettings.visionModPath;
        if(enabled&&!source)throw new Error('请先选择 Vision Mod 目录');
        await window.electronAPI.setVisionModule(war3Path,source||'',module,enabled);
        const next={...previousSettings,[module]:enabled};
        try{await window.electronAPI.setConfig('modSettings',next);}catch(error){await window.electronAPI.setVisionModule(war3Path,source||'',module,!enabled);throw error;}
        setState({modSettings:next});return;
      }
      const modules=await window.electronAPI.getVisionModules(war3Path);
      if(Object.keys(newSettings).some(key=>visionBlocksSetting(modules,key)))throw new Error('请先关闭接管该设置的 Vision Mod 模块');
      if(newSettings.visionModPath && Object.values(modules).some(Boolean))throw new Error('更换目录前请先关闭 Vision Mod 模块');
      // Do not write an old renderer snapshot over a newer applied profile.
      previousSettings = await readResolvedProfile(previousSettings);
      const installed = await window.electronAPI?.getInstalledModState?.(war3Path);
      if (installed?.sequence === 34 && Object.keys(newSettings).some(key => key !== 'modEnabled' && key !== 'visionModPath')) {
        throw new Error('请先通过首页将 3.4 MOD 更新到 3.5，再修改资源设置');
      }
      if (requiresFullPackageChange(newSettings) && window.electronAPI?.getFullPackageStatus) {
        const installed = await window.electronAPI.getFullPackageStatus(war3Path);
        if (!installed) {
          throw new Error('完整包未安装，无法修改地形、树木或水面设置');
        }
      }

      const selectedChannel = await window.electronAPI?.getConfig?.('gameChannel');
      const branchStates = await window.electronAPI?.getBranchModStates?.().catch(() => null);
      const branchEnabled = branchStates?.[selectedChannel === 'ptr' ? 'ptr' : 'retail']?.enabled
        ?? newSettings.modEnabled ?? store.modSettings.modEnabled;

      if(newSettings.hdrExposure !== undefined && Object.keys(newSettings).length===1){
        const exposure=validateHdrExposure(newSettings.hdrExposure);
        if(!window.electronAPI?.updateHdrExposure)throw new Error('整体亮度设置不可用');
        if(await window.electronAPI.updateHdrExposure(war3Path,exposure)===false)throw new Error('整体亮度设置未完成');
        setState({modSettings:{...previousSettings,hdrExposure:exposure}});
        reportProgress('finish',100);return;
      }

      if (newSettings.atmosphericLight !== undefined && Object.keys(newSettings).length === 1) {
        if(typeof newSettings.atmosphericLight!=='boolean')throw new Error('Invalid atmospheric light setting');
        const next={...previousSettings,atmosphericLight:newSettings.atmosphericLight};
        if(branchEnabled){
          if(!window.electronAPI?.updateAtmosphericLight)throw new Error('大气光设置不可用');
          if(await window.electronAPI.updateAtmosphericLight(war3Path,next.atmosphericLight)===false)throw new Error('大气光设置未完成');
        }else await window.electronAPI.setConfig('modSettings',next);
        setState({modSettings:next});reportProgress('finish',100);return;
      }
      if (newSettings.rotatingLighting !== undefined && Object.keys(newSettings).length === 1) {
        if (typeof newSettings.rotatingLighting !== 'boolean') throw new Error('Invalid rotating lighting setting');
        const next = { ...previousSettings, rotatingLighting: newSettings.rotatingLighting };
        if (branchEnabled) {
          if (!window.electronAPI?.updateRotatingLighting) throw new Error('旋转光照设置不可用');
          const applied = await window.electronAPI.updateRotatingLighting(war3Path, next.rotatingLighting);
          if (applied === false) throw new Error('旋转光照设置未完成');
        } else {
          await window.electronAPI.setConfig('modSettings', next);
        }
        setState({ modSettings: next });
        reportProgress('finish', 100);
        return;
      }

      if(newSettings.shadowLength!==undefined&&Object.keys(newSettings).length===1){
        const shadowLength=validateUnitShadowSetting(newSettings.shadowLength);
        const next={...previousSettings,shadowLength};
        if(branchEnabled){
          if(!window.electronAPI?.updateShadowLength)throw new Error('阴影长度设置不可用');
          if(await window.electronAPI.updateShadowLength(war3Path,shadowLength)===false)throw new Error('阴影长度设置未完成');
        }else await window.electronAPI.setConfig('modSettings',next);
        setState({modSettings:next});reportProgress('finish',100);return;
      }

      if (newSettings.lightingAngle !== undefined && Object.keys(newSettings).length === 1) {
        const angle=newSettings.lightingAngle;
        if (angle!==null)validateUnitLightAngle(angle);
        const next={...previousSettings,lightingAngle:angle};
        if(branchEnabled) {
          if(!window.electronAPI?.updateLightingAngle)throw new Error('光照角度设置不可用');
          if(await window.electronAPI.updateLightingAngle(war3Path,angle)===false)throw new Error('光照角度设置未完成');
        } else await window.electronAPI.setConfig('modSettings',next);
        setState({modSettings:next});
        reportProgress('finish',100);
        return;
      }

      // Apply the independent Blight toggle before persisting its preference.
      // A custom-file conflict leaves both the previous setting and files intact.
      if (newSettings.blight !== undefined && Object.keys(newSettings).length === 1) {
        const next = { ...previousSettings, blight: newSettings.blight };
        if (branchEnabled) {
          if (!window.electronAPI?.updateBlightSettings) throw new Error('腐蚀之地设置不可用');
          await window.electronAPI.updateBlightSettings(war3Path, next.blight);
        }
        await window.electronAPI.setConfig('modSettings', next);
        setState({ modSettings: next });
        return;
      }

      reportProgress('save', 8);
      const previousLighting = store.modSettings.lighting;
      const previousLightingBrightness = store.modSettings.lightingBrightness ?? 3;
      const previousTerrain =
        newSettings.terrain !== undefined ? store.modSettings.terrain : undefined;
      let updatedSettings = withHdrExposure(previousSettings, newSettings);
      if (newSettings.graphicsSelection === 'de' && previousSettings.graphicsSelection !== 'de') {
        updatedSettings.tree = 'original';
      }

      // Retro terrain never uses foliage
      if (updatedSettings.terrain === 'retro') {
        updatedSettings = { ...updatedSettings, foliage: false };
      }
      // Cannot enable foliage while on retro terrain
      if (newSettings.foliage === true && updatedSettings.terrain === 'retro') {
        updatedSettings = { ...updatedSettings, foliage: false };
      }

      console.log('[useWar3Settings] Updated settings state:', updatedSettings);

      setState({ modSettings: updatedSettings });

      if (window.electronAPI?.setConfig) {
        console.log('[useWar3Settings] Calling setConfig...');
        await window.electronAPI.setConfig('modSettings', updatedSettings);
      } else {
        console.warn('[useWar3Settings] window.electronAPI.setConfig is undefined');
      }

      // The selected graphics profile still controls the game's hd flag.
      if (newSettings.graphicsSelection === 'sd' || newSettings.graphicsSelection === 'hd' || newSettings.graphicsSelection === 'de') {
        reportProgress('write-graphics', 18);
        await saveSettings(war3Path, { hd: hdValueForGraphics(newSettings.graphicsSelection) });
      }

      // Store preferences while off, without recreating UI, lighting, terrain or other overrides.
      if (!branchEnabled) {
        reportProgress('finish', 100);
        return;
      }

      if (newSettings.blight !== undefined) await window.electronAPI.updateBlightSettings(war3Path, updatedSettings.blight);

      // Version/graphics profile changes require a complete resource transition.
      const profileChanged = newSettings.versionSelection !== undefined || newSettings.graphicsSelection !== undefined;
      if (profileChanged) {
        if (!window.electronAPI?.syncAssets) throw new Error('Resource sync is unavailable');
        reportProgress('sync-start', 24);
        await window.electronAPI.syncAssets(war3Path);
        updatedSettings = await readResolvedProfile(updatedSettings);
        setState({ modSettings: updatedSettings });
        // Tree skins are applied by syncAssets using the resolved version's table.
        // Re-apply terrain/water after graphics layout (DE doodads/water, HD restore).
        if (branchEnabled && updatedSettings.graphicsSelection !== 'sd' && window.electronAPI?.updateTerrainSettings) {
          reportProgress('terrain', 88);
          await window.electronAPI.updateTerrainSettings(war3Path, updatedSettings.terrain, updatedSettings.water, previousTerrain);
        }
        if (branchEnabled && updatedSettings.graphicsSelection !== 'sd' && updatedSettings.graphicsSelection !== 'de' && window.electronAPI?.updateWaterSettings) {
          reportProgress('water', 97);
          await window.electronAPI.updateWaterSettings(war3Path, updatedSettings.water);
        }
      }

      // 优化触发逻辑：
      // 1. 当修改了 lighting 或 lightingBrightness 时触发
      // 2. 如果当前正在切换 MOD 开关 (modEnabled)，则跳过更新，因为 MOD 开关本身会移动整个目录，避免冲突
      // 3. 只有在 MOD 处于开启状态时，才去修改 _retail_ 下的 MDL 文件
      if (
        (newSettings.lighting !== undefined || newSettings.lightingBrightness !== undefined) &&
        !profileChanged &&
        newSettings.modEnabled === undefined &&
        branchEnabled
      ) {
        console.log('[useWar3Settings] Lighting / brightness changed, updating MDL files...');
        // 确保调用正确的 API 名称
        if (window.electronAPI?.updateMdlLighting) {
          const requestId = crypto.randomUUID();
          const listener = (event: Event) => {
            const detail = (event as CustomEvent<{ operation?: string; requestId?: string; step: string; percent: number }>).detail;
            if (detail?.operation === 'lighting' && detail.requestId === requestId) {
              reportProgress(detail.step, 12 + detail.percent * 0.53);
            }
          };
          window.addEventListener('mod-profile-progress', listener);
          removeLightingProgress = () => window.removeEventListener('mod-profile-progress', listener);
          reportProgress('sync-start', 12);
          // 人为延迟以显示Loading效果，提升用户体验
          // await new Promise(resolve => setTimeout(resolve, 800)); // 已移除

          console.log('[useWar3Settings] Invoking updateMdlLighting IPC...');

          // 增加超时保护，防止 IPC 调用卡死导致 loading 无法消失
          const updatePromise = window.electronAPI.updateMdlLighting(
            war3Path,
            updatedSettings.lighting,
            updatedSettings.lightingBrightness,
            previousLighting,
            previousLightingBrightness,
            requestId
          );

          const result = await new Promise<boolean>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Update MDL lighting timeout')), 45000);
            updatePromise.then(
              (value) => {
                clearTimeout(timer);
                resolve(value);
              },
              (err) => {
                clearTimeout(timer);
                reject(err);
              }
            );
          });
          console.log('[useWar3Settings] updateMdlLighting result:', result);
          removeLightingProgress();
          removeLightingProgress = undefined;
        } else {
          console.warn('[useWar3Settings] window.electronAPI.updateMdlLighting is undefined');
        }
      } else {
        console.log('[useWar3Settings] No lighting/brightness/modEnabled change detected, skipping updateMdlLighting');
      }

      // 如果修改了 UI 设置，执行 UI 资源替换和 unitskinMode 切换
      if (newSettings.ui !== undefined) {
        reportProgress('layout', 66);
        console.log('[useWar3Settings] UI setting changed, triggering updateUISettings and switchUnitSkinMode...');
        if (window.electronAPI?.updateUISettings) {
          console.log('[useWar3Settings] Invoking updateUISettings IPC...');

          // 增加超时保护
          const updateUiPromise = window.electronAPI.updateUISettings(war3Path, updatedSettings.ui);
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Update UI settings timeout')), 15000)
          );

          await Promise.race([updateUiPromise, timeoutPromise]);
          console.log('[useWar3Settings] updateUISettings completed');
        } else {
          console.warn('[useWar3Settings] window.electronAPI.updateUISettings is undefined');
        }
      }

      // 如果修改了地形设置，执行地形资源切换 (terrainart <-> QMoff)
      if (newSettings.terrain !== undefined && !profileChanged) {
        reportProgress('terrain', 68);
        console.log('[useWar3Settings] Terrain setting changed, triggering updateTerrainSettings...');
        if (window.electronAPI?.updateTerrainSettings) {
          console.log('[useWar3Settings] Invoking updateTerrainSettings IPC...');

          await awaitResourceUpdate('terrain', requestId => window.electronAPI.updateTerrainSettings(
            war3Path, updatedSettings.terrain, updatedSettings.water, previousTerrain, requestId,
          ), 68, 7);
          foliageAppliedByTerrain = newSettings.foliage === true;
          // 切换完成后，重新检测实际文件状态以更新高亮
          const detectedTerrainAfter = await detectTerrainMode(war3Path);
          const afterTerrain = {
            ...updatedSettings,
            terrain: detectedTerrainAfter,
            foliage: detectedTerrainAfter === 'retro' ? false : updatedSettings.foliage,
          };
          setState({ modSettings: afterTerrain });
          if (window.electronAPI?.setConfig) {
            await window.electronAPI.setConfig('modSettings', afterTerrain);
          }
          console.log('[useWar3Settings] updateTerrainSettings completed');
        } else {
          console.warn('[useWar3Settings] window.electronAPI.updateTerrainSettings is undefined');
        }
      }

      // 如果修改了树木设置，执行树木设置更新
      if (newSettings.tree !== undefined) {
        reportProgress('trees', 76);
        console.log(`\n>>> [TREE-FRONTEND] Setting change requested: ${newSettings.tree}`);
        if (window.electronAPI?.updateTreeSettings) {
          console.log('[useWar3Settings] Calling updateTreeSettings API...');

          const updateTreePromise = window.electronAPI.updateTreeSettings(war3Path, updatedSettings.tree);
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Update tree settings timeout')), 30000)
          );

          await Promise.race([updateTreePromise, timeoutPromise]);

          // 重新检测状态
          const detectedTreeAfter = await detectTreeMode(war3Path);
          console.log(`[useWar3Settings] updateTreeSettings completed. Detected mode: ${detectedTreeAfter}`);
          setState({ modSettings: { ...store.modSettings, tree: detectedTreeAfter } });
        } else {
          console.error('[useWar3Settings] FATAL: window.electronAPI.updateTreeSettings is UNDEFINED!');
          // 打印出当前所有的 API，帮助调试
          console.log('[useWar3Settings] Available APIs:', Object.keys(window.electronAPI || {}));
        }
      }

      // 如果修改了水面设置，执行水面效果更新
      if (newSettings.water !== undefined) {
        reportProgress('water', 80);
        console.log(`\n>>> [WATER-FRONTEND] Setting change requested: ${newSettings.water}`);
        if (window.electronAPI?.updateWaterSettings) {
          console.log('[useWar3Settings] Calling updateWaterSettings API...');
          const updateWaterPromise = window.electronAPI.updateWaterSettings(war3Path, updatedSettings.water);
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Update water settings timeout')), 30000)
          );
          await Promise.race([updateWaterPromise, timeoutPromise]);
          const detectedWaterAfter = await detectWaterMode(war3Path);
          console.log(`[useWar3Settings] updateWaterSettings completed. Detected mode: ${detectedWaterAfter}`);
          setState({ modSettings: { ...store.modSettings, water: detectedWaterAfter } });
        }
      }

      // 如果修改了植被设置，执行植被效果更新
      if (newSettings.foliage !== undefined && !foliageAppliedByTerrain) {
        reportProgress('environment', 82);
        if (updatedSettings.terrain === 'retro') {
          console.log('[useWar3Settings] Retro terrain: forcing foliage off');
          if (window.electronAPI?.updateFoliageSettings) {
            await awaitResourceUpdate('foliage', requestId => window.electronAPI.updateFoliageSettings(war3Path, false, 'retro', requestId), 82, 3);
          }
          setState({ modSettings: { ...store.modSettings, foliage: false } });
        } else {
          console.log(`\n>>> [FOLIAGE-FRONTEND] Setting change requested: ${newSettings.foliage}`);
          if (window.electronAPI?.updateFoliageSettings) {
            console.log('[useWar3Settings] Calling updateFoliageSettings API...');
            await awaitResourceUpdate('foliage', requestId => window.electronAPI.updateFoliageSettings(
              war3Path, updatedSettings.foliage, updatedSettings.terrain, requestId,
            ), 82, 3);
          }
        }
      }

      // 如果修改了物体着色器设置，执行更新
      if (newSettings.objectShader !== undefined) {
        reportProgress('shaders', 86);
        console.log(`\n>>> [SHADER-FRONTEND] Object Shader change requested: ${newSettings.objectShader}`);
        if (window.electronAPI?.updateObjectShader) {
          const applied = await window.electronAPI.updateObjectShader(war3Path, updatedSettings.objectShader);
          if (applied === false) throw new Error('当前魔兽版本缺少物体着色器资源，切换未完成');
          // Off still has identity writers for fog composition. File presence
          // cannot override the preference after a successful native update.
        } else throw new Error('物体着色器设置不可用');
      }

      // 如果修改了后处理阴影设置，执行更新
      if (newSettings.postProcessing !== undefined) {
        reportProgress('shaders', 89);
        console.log(`\n>>> [SHADER-FRONTEND] Post-processing shadow change requested: ${newSettings.postProcessing}`);
        if (window.electronAPI?.updatePostProcessing) {
          const applied = await window.electronAPI.updatePostProcessing(war3Path, updatedSettings.postProcessing);
          if (applied === false) throw new Error('当前魔兽版本缺少后处理阴影资源，切换未完成');
        } else throw new Error('后处理阴影设置不可用');
      }

      if (newSettings.postProcessingOutline !== undefined) {
        reportProgress('shaders', 91);
        const applied = await window.electronAPI.updatePostProcessingOutline(war3Path, updatedSettings.postProcessingOutline);
        if (applied === false) throw new Error('描边设置未完成');
      }

      if (newSettings.hdr !== undefined) {
        reportProgress('shaders', 92);
        const applied = await window.electronAPI.updateHdr(war3Path, updatedSettings.hdr);
        if (applied === false) throw new Error('HDR 色调映射设置未完成');
      }

      if (newSettings.postProcessingGlow !== undefined) {
        reportProgress('shaders', 93);
        console.log(`\n>>> [SHADER-FRONTEND] Post-processing glow change requested: ${newSettings.postProcessingGlow}`);
        if (window.electronAPI?.updatePostProcessingGlow) {
          const applied = await window.electronAPI.updatePostProcessingGlow(war3Path, updatedSettings.postProcessingGlow);
          if (applied === false) throw new Error('当前魔兽版本缺少后处理辉光资源，切换未完成');
        } else throw new Error('后处理辉光设置不可用');
      }

      if (newSettings.improveReadability !== undefined) {
        reportProgress('shaders', 95);
        const applied = await window.electronAPI.updateReadability(war3Path, updatedSettings.improveReadability);
        if (applied === false) throw new Error('Readability settings were not applied');
      }

      // 如果修改了光晕设置
      if (newSettings.glow !== undefined) {
        reportProgress('layout', 97);
        console.log(`\n>>> [GLOW-FRONTEND] Glow change requested: ${newSettings.glow}`);
        if (window.electronAPI?.updateGlowSettings) {
          if (await window.electronAPI.updateGlowSettings(war3Path, updatedSettings.glow) === false) throw new Error('光晕设置未完成');
        }
      }

      // 如果修改了半身头像设置
      if (newSettings.half !== undefined) {
        reportProgress('layout', 98);
        console.log(`\n>>> [VISION-FRONTEND] Half Portrait change requested: ${newSettings.half}`);
        if (window.electronAPI?.updateHalfPortrait) {
          if (!updatedSettings.visionModPath) {
            console.warn('[useWar3Settings] VisionMod path not set, reverting half portrait setting');
            setState({ modSettings: { ...updatedSettings, half: !newSettings.half } });
            // 不抛出错误防止阻断其他逻辑，但显示错误消息
            // throw new Error('请先设置 VisionMod 路径');
            // 实际上这里的 throw 会被 catch 捕获并显示 toast，所以 throw 是合适的
            throw new Error('请先设置 VisionMod 路径 / Please set VisionMod path first');
          }
          await window.electronAPI.updateHalfPortrait(war3Path, updatedSettings.visionModPath, updatedSettings.half);
        }
      }

      // 如果修改了模型增强设置
      if (newSettings.modelEnhance !== undefined) {
        reportProgress('layout', 99);
        console.log(`\n>>> [VISION-FRONTEND] Model Enhance change requested: ${newSettings.modelEnhance}`);
        if (window.electronAPI?.updateModelEnhance) {
          if (!updatedSettings.visionModPath) {
            console.warn('[useWar3Settings] VisionMod path not set, reverting model enhance setting');
            setState({ modSettings: { ...updatedSettings, modelEnhance: !newSettings.modelEnhance } });
            throw new Error('请先设置 VisionMod 路径 / Please set VisionMod path first');
          }
          await window.electronAPI.updateModelEnhance(war3Path, updatedSettings.visionModPath, updatedSettings.modelEnhance);
        }
      }
      if(newSettings.atmosphericLight!==undefined&&!profileChanged){
        if(!window.electronAPI?.updateAtmosphericLight)throw new Error('大气光设置不可用');
        if(await window.electronAPI.updateAtmosphericLight(war3Path,updatedSettings.atmosphericLight===true)===false)throw new Error('大气光设置未完成');
      }
      reportProgress('finish', 100);
    } catch (error) {
      console.error('Failed to save mod settings:', error);
      if (window.electronAPI?.setConfig) {
        await window.electronAPI.setConfig('modSettings', previousSettings).catch((restoreError) => {
          console.error('Failed to restore previous MOD settings:', restoreError);
        });
      }
      setState({ modSettings: previousSettings });
      throw error;
    } finally {
      removeLightingProgress?.();
      // 确保在任何情况下都关闭 loading
      console.log('[useWar3Settings] saveModSettings finished, setting isLoading to false');
      modSettingsSaving = false;
      setState({ isLoading: false });
    }
  };

  // 生成MOD设置内容
  const generateModSettings = (settings: ModSettings): string => {
    return `[mod]
objectShader=${settings.objectShader ? '1' : '0'}
postProcessing=${settings.postProcessing ? '1' : '0'}
postProcessingGlow=${settings.postProcessingGlow ? '1' : '0'}
hdr=${settings.hdr ? '1' : '0'}
hdrExposure=${resolveHdrExposure(settings)}
postProcessingOutline=${settings.postProcessingOutline ? '1' : '0'}
volumetricFog=${settings.volumetricFog ? '1' : '0'}
water=${settings.water === 'realistic' ? '1' : settings.water === 'transparent' ? '2' : '0'}
foliage=${settings.foliage ? '1' : '0'}
blight=${settings.blight ? '1' : '0'}
lighting=${settings.lighting === 'enhanced' ? '1' : settings.lighting === 'battle' ? '2' : settings.lighting === 'rpg' ? '3' : '0'}
lightingBrightness=${settings.lightingBrightness ?? 3}
lightingAngle=${settings.lightingAngle===null?'default':settings.lightingAngle ?? ''}
shadowLength=${settings.shadowLength ?? 50}
half=${settings.half ? '1' : '0'}
ui=${settings.ui}
cam=${settings.cam ? '1' : '0'}
glow=${settings.glow ? '1' : '0'}
terrain=${settings.terrain}
tree=${settings.tree}
improveReadability=${settings.improveReadability ? '1' : '0'}
    modelEnhance=${settings.modelEnhance ? '1' : '0'}
    visionModPath=${settings.visionModPath}
    modEnabled=${settings.modEnabled ? '1' : '0'}

    [camera]
fov=${store.cameraSettings.fieldOfView}
angle=${store.cameraSettings.angleOfAttack}
`;
  };

  // 加载相机设置
  const loadCameraSettings = async (war3Path: string) => {
    try {
      // 从blizzard.j读取相机设置
      const blizzardPath = `${war3Path}/scripts/blizzard.j`;
      const exists = await window.electronAPI?.pathExists(blizzardPath);

      if (exists) {
        const content = await window.electronAPI?.readFile(blizzardPath);
        const cameraSettings = parseCameraSettings(content);
        setState({ cameraSettings });
      }
    } catch (error) {
      console.error('Failed to load camera settings:', error);
    }
  };

  // 解析相机设置
  const parseCameraSettings = (content: string): CameraSettings => {
    const settings = { ...store.cameraSettings };

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 查找相机设置行
      if (line.includes('SetCameraField(CAMERA_FIELD_FIELD_OF_VIEW')) {
        const match = line.match(/SetCameraField\(CAMERA_FIELD_FIELD_OF_VIEW,\s*([0-9.]+)/);
        if (match) {
          settings.fieldOfView = parseFloat(match[1]);
          settings.enabled = true;
        }
      }

      if (line.includes('SetCameraField(CAMERA_FIELD_ANGLE_OF_ATTACK')) {
        const match = line.match(/SetCameraField\(CAMERA_FIELD_ANGLE_OF_ATTACK,\s*([0-9.-]+)/);
        if (match) {
          settings.angleOfAttack = parseFloat(match[1]);
        }
      }
    }

    return settings;
  };

  // 基于文件存在情况检测地形模式，用于按钮高亮与状态同步
  const detectTerrainMode = async (war3Path: string): Promise<ModSettings['terrain']> => {
    try {
      const retailDir = await getSelectedGameBuildDir(war3Path);
      const baseDir = (await window.electronAPI?.pathExists(retailDir)) ? retailDir : war3Path;
      const terrainDir = `${baseDir}/terrainart`;
      const terrainSlkPath = `${terrainDir}/terrain.slk`;
      const terrainSlkExists = await window.electronAPI?.pathExists(terrainSlkPath);

      const metaPath = `${terrainDir}/meta.que`;
      const metaExists = await window.electronAPI?.pathExists(metaPath);
      if (metaExists) {
        // @ts-ignore
        const meta = ((await window.electronAPI.readFile(metaPath)) || '').trim();
        if (meta === 'original') return 'original';
        if (meta === '30') return 'decisive';
        if (meta === '00') return 'retro';
        if (meta === '16') return 'v16';
        if (meta === '18') return 'v18';
        if (meta === '20') return 'latest';
      }

      // QMF3.5 default: decisive tiles in terrainart without root SLK / without meta yet.
      if (!terrainSlkExists) {
        const t30MarkerPath = `${baseDir}/t30/keep.txt`;
        const t30Exists = await window.electronAPI?.pathExists(t30MarkerPath);
        if (t30Exists) return 'decisive';
        return 'original';
      }

      return 'latest';
    } catch (e) {
      console.warn('[useWar3Settings] detectTerrainMode failed:', e);
      return store.modSettings.terrain;
    }
  };

  // 保存相机设置
  const saveCameraSettings = async (war3Path: string, newSettings: Partial<CameraSettings>) => {
    try {
      const updatedSettings = { ...store.cameraSettings, ...newSettings };
      setState({ cameraSettings: updatedSettings });

      // 修改blizzard.j文件
      const blizzardPath = `${war3Path}/scripts/blizzard.j`;
      const exists = await window.electronAPI?.pathExists(blizzardPath);

      if (exists) {
        const content = await window.electronAPI?.readFile(blizzardPath);
        const modifiedContent = modifyBlizzardScript(content, updatedSettings);
        await window.electronAPI?.writeFile(blizzardPath, modifiedContent);

        // 备份到quenching目录
        const backupPath = `${war3Path}/Quenching/scripts/blizzard.j`;
        await window.electronAPI?.copyFile(blizzardPath, backupPath);
      }

      // 同时保存到MOD设置
      await saveModSettings(war3Path, { cam: updatedSettings.enabled });

    } catch (error) {
      console.error('Failed to save camera settings:', error);
      throw error;
    }
  };

  // 修改blizzard.j脚本
  const modifyBlizzardScript = (content: string, settings: CameraSettings): string => {
    // 简单的替换逻辑，实际可能需要更复杂的解析
    let newContent = content;

    // TODO: 实现blizzard.j的修改逻辑
    // 这里暂时只是占位，实际需要根据settings修改SetCameraField等函数调用

    return newContent;
  };

  const statics = {};

  return Object.assign(() => ({
    store,
    loadSettings,
    saveSettings,
    toggleGameMode,
    setResolution,
    loadModSettings,
    saveModSettings,
    loadCameraSettings,
    saveCameraSettings
  }), {
    store,
    setState,
    loadSettings,
    saveSettings,
    toggleGameMode,
    setResolution,
    loadModSettings,
    saveModSettings,
    loadCameraSettings,
    saveCameraSettings,
    statics
  });
});

// React Hook
export const useWar3Settings = () => {
  // 获取reaxel实例
  const settings = reaxel_War3Settings();
  const [state, setLocalState] = useState(() => ({
    detectedVersion: settings.store.detectedVersion,
    settings: settings.store.settings,
    cameraSettings: settings.store.cameraSettings,
    modSettings: settings.store.modSettings,
    isLoading: settings.store.isLoading
  }));

  useEffect(() => {
    return reaction(
      () => [settings.store.settings, settings.store.cameraSettings, settings.store.modSettings, settings.store.isLoading, settings.store.detectedVersion],
      () => {
        const current = settings.store;
        setLocalState({
          detectedVersion: current.detectedVersion,
          settings: { ...current.settings },
          cameraSettings: { ...current.cameraSettings },
          modSettings: { ...current.modSettings },
          isLoading: current.isLoading
        });
      },
      { fireImmediately: true }
    );
  }, [settings.store]);

  return {
    detectedVersion: state.detectedVersion,
    settings: state.settings,
    cameraSettings: state.cameraSettings,
    modSettings: state.modSettings,
    isLoading: state.isLoading,
    loadSettings: settings.loadSettings,
    saveSettings: settings.saveSettings,
    toggleGameMode: settings.toggleGameMode,
    setResolution: settings.setResolution,
    saveModSettings: settings.saveModSettings,
    loadModSettings: settings.loadModSettings,
    saveCameraSettings: settings.saveCameraSettings,
    loadCameraSettings: settings.loadCameraSettings
  };
};
