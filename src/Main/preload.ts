import { contextBridge, ipcRenderer } from 'electron';
import { IS_TEST_RELEASE } from '../shared/local-release';

// 暴露安全的API给渲染进程
const electronAPI: ElectronAPI = {
  getVisionModules: root => ipcRenderer.invoke('vision:modules',root),
  setVisionModule: (root,source,module,enabled) => ipcRenderer.invoke('vision:set-module',root,source,module,enabled),
  showForum: bounds => ipcRenderer.invoke('forum:show', bounds),
  setForumBounds: bounds => ipcRenderer.invoke('forum:bounds', bounds),
  hideForum: () => ipcRenderer.invoke('forum:hide'),
  reloadForum: () => ipcRenderer.invoke('forum:reload'),
  // 文件操作
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('file:write', filePath, content),
  copyFile: (sourcePath: string, targetPath: string) => ipcRenderer.invoke('file:copy', sourcePath, targetPath),
  moveFile: (sourcePath: string, targetPath: string) => ipcRenderer.invoke('file:move', sourcePath, targetPath),
  moveDirectory: (sourceDir: string, targetDir: string) => ipcRenderer.invoke('file:move-directory', sourceDir, targetDir),
  deleteFile: (filePath: string) => ipcRenderer.invoke('file:delete', filePath),
  pathExists: (filePath: string) => ipcRenderer.invoke('file:exists', filePath),
  getCurrentDirectory: () => ipcRenderer.invoke('file:getCurrentDirectory'),

  // 游戏启动
  ...(IS_TEST_RELEASE ? {launchOfflineStarterMap: () => ipcRenderer.invoke('game:launch-offline-starter')} : {}),
  launchGame: (executablePath?: string) => ipcRenderer.invoke('game:launch', executablePath),
  ensureLocalFiles: () => ipcRenderer.invoke('game:ensure-local-files'),
  startBundledResourcePreparation: () => ipcRenderer.invoke('resources:startup-ready'),
  onBundledResourceProgress: callback => {
    const listener=(_event:unknown,status:BundledResourceStartupStatus)=>callback(status);
    ipcRenderer.on('resources:startup-progress',listener);
    return ()=>ipcRenderer.removeListener('resources:startup-progress',listener);
  },
  onStartupRenderingResult: callback => {
    const listener = (_event: unknown, result: StartupRenderingResult) => callback(result);
    ipcRenderer.on('mod:startup-rendering-result', listener);
    return () => ipcRenderer.removeListener('mod:startup-rendering-result', listener);
  },
  launchMap: (mapPath: string, difficulty: number) => ipcRenderer.invoke('game:launch-map', mapPath, difficulty),
  unlockCampaign: (mapName?: string) => ipcRenderer.invoke('campaign:unlock', mapName),
  getCampaignUnlockMode: () => ipcRenderer.invoke('campaign:unlock-mode'),
  extractCampaignW3n: (w3nPath: string) => ipcRenderer.invoke('campaign:extract-w3n', w3nPath),
  listInstalledCampaigns: () => ipcRenderer.invoke('campaign:list-installed'),
  selectGamePath: () => ipcRenderer.invoke('game:select-path'),
  getConfig: (key: string) => ipcRenderer.invoke('config:get', key),
  setConfig: (key: string, value: any) => ipcRenderer.invoke('config:set', key, value),
  applyTheme: (themeId: string) => ipcRenderer.invoke('theme:apply', themeId),
  updateMdlLighting: (
    war3Path: string,
    lightingMode: string,
    lightingBrightness?: number,
    previousLightingMode?: string,
    previousLightingBrightness?: number,
    requestId?: string,
  ) =>
    ipcRenderer.invoke(
      'mdl:update-lighting',
      war3Path,
      lightingMode,
      lightingBrightness,
      previousLightingMode,
      previousLightingBrightness,
      requestId
    ),
  updateUISettings: (war3Path: string, uiMode: string) => ipcRenderer.invoke('ui:update-settings', war3Path, uiMode),
  updateAtmosphericLight: (war3Path: string, enabled: boolean) => ipcRenderer.invoke('mdl:update-atmospheric-light', war3Path, enabled),
  updateShadowLength: (war3Path:string,value:'short'|'long'|'default'|number) => ipcRenderer.invoke('mdl:update-shadow-length',war3Path,value),
  updateRotatingLighting: (war3Path: string, enabled: boolean) => ipcRenderer.invoke('mdl:update-rotating-lighting', war3Path, enabled),
  updateLightingAngle: (war3Path: string, angle: number|null) => ipcRenderer.invoke('mdl:update-lighting-angle', war3Path, angle),
  syncUISettings: (war3Path: string) => ipcRenderer.invoke('ui:sync-settings', war3Path),
  updateTerrainSettings: (war3Path: string, terrainMode: string, waterMode?: string, previousTerrainMode?: string, requestId?: string) => ipcRenderer.invoke('terrain:update-settings', war3Path, terrainMode, waterMode, previousTerrainMode, requestId),
  updateTreeSettings: (war3Path: string, treeMode: string) => ipcRenderer.invoke('tree:update-settings', war3Path, treeMode),
  updateWaterSettings: (war3Path: string, waterMode: string) => ipcRenderer.invoke('water:update-settings', war3Path, waterMode),
  updateFoliageSettings: (war3Path: string, enabled: boolean, terrainMode?: string, requestId?: string) => ipcRenderer.invoke('foliage:update-settings', war3Path, enabled, terrainMode, requestId),
  updateBlightSettings: (war3Path: string, enabled: boolean) => ipcRenderer.invoke('blight:update-settings', war3Path, enabled),
  updateObjectShader: (war3Path: string, enabled: boolean) => ipcRenderer.invoke('shader:update-object-shader', war3Path, enabled),
  updatePostProcessing: (war3Path: string, enabled: boolean) => ipcRenderer.invoke('shader:update-post-processing', war3Path, enabled),
  updatePostProcessingGlow: (war3Path: string, enabled: boolean) => ipcRenderer.invoke('shader:update-post-processing-glow', war3Path, enabled),
  updateHdrExposure: (war3Path: string, exposure: number) => ipcRenderer.invoke('shader:update-hdr-exposure',war3Path,exposure),
  updateHdr: (war3Path: string, enabled: boolean) => ipcRenderer.invoke('shader:update-hdr', war3Path, enabled),
  updatePostProcessingOutline: (war3Path: string, enabled: boolean) => ipcRenderer.invoke('shader:update-post-processing-outline', war3Path, enabled),
  /** @deprecated Manual toggle removed; always syncs shaders from detected War3 version. */
  updateLegacyWar3Shader: (war3Path: string, enabled?: boolean) => ipcRenderer.invoke('shader:update-legacy-war3', war3Path, enabled),
  syncVersionedShaders: (war3Path?: string) => ipcRenderer.invoke('shader:sync-versioned', war3Path),
  detectWar3Version: (war3Path?: string) => ipcRenderer.invoke('war3:detect-version', war3Path),
  updateReadability: (war3Path: string, enabled: boolean) => ipcRenderer.invoke('shader:update-readability', war3Path, enabled),
  updateGlowSettings: (war3Path: string, enabled: boolean) => ipcRenderer.invoke('glow:update-settings', war3Path, enabled),
  getAntiHarmonyStatus: (war3Path?: string) => ipcRenderer.invoke('anti-harmony:get-status', war3Path),
  setAntiHarmonyEnabled: (war3Path: string | undefined, enabled: boolean) =>
    ipcRenderer.invoke('anti-harmony:set-enabled', war3Path, enabled),
  installAntiHarmony: (war3Path?: string) => ipcRenderer.invoke('anti-harmony:install', war3Path),
  updateHalfPortrait: (war3Path: string, visionModPath: string, enabled: boolean) => ipcRenderer.invoke('vision:update-half-portrait', war3Path, visionModPath, enabled),
  updateModelEnhance: (war3Path: string, visionModPath: string, enabled: boolean) => ipcRenderer.invoke('vision:update-model-enhance', war3Path, visionModPath, enabled),
  applySkin: (unitId: string, changes: any[]) => ipcRenderer.invoke('skin:apply', unitId, changes),
  getVersionSkinPanel: (artSet: 'sd' | 'hd' | 'de') => ipcRenderer.invoke('skin:version-panel', artSet),
  applyVersionSkins: (artSet: 'sd' | 'hd' | 'de', choices: any[]) => ipcRenderer.invoke('skin:version-apply', artSet, choices),
  applyBatchSkin: (batchChanges: any[]) => ipcRenderer.invoke('skin:apply-batch', batchChanges),
  disableSkins: () => ipcRenderer.invoke('skin:disable'),
  enableSkins: () => ipcRenderer.invoke('skin:enable'),
  isSkinEnabled: () => ipcRenderer.invoke('skin:is-enabled'),
  getRetroSkinStatus: () => ipcRenderer.invoke('retro-skin:get-status'),
  applyRetroSkin: (options: { unitsEnabled?: boolean; buildingsEnabled?: boolean }) =>
    ipcRenderer.invoke('retro-skin:apply', options),
  selectModelFile: () => ipcRenderer.invoke('file:select-model'),
  selectFile: (options: { title?: string, filters?: { name: string, extensions: string[] }[] }) => ipcRenderer.invoke('file:select', options),
  selectFiles: (options: { title?: string, filters?: { name: string, extensions: string[] }[] }) => ipcRenderer.invoke('file:select-multiple', options),
  selectDirectory: (title?: string) => ipcRenderer.invoke('file:select-directory', title),
  readModelResource: (path: string, basePath?: string, artSet?: 'sd' | 'hd' | 'de') => ipcRenderer.invoke('model:read-resource', { path, basePath, artSet }),
  listCustomSkins: (targetId?: string) => ipcRenderer.invoke('custom-skin:list', targetId),
  inspectCustomSkinModel: (modelPath: string, artSet?: 'sd' | 'hd' | 'de', portraitPath?: string) => ipcRenderer.invoke('custom-skin:inspect-model', modelPath, artSet, portraitPath),
  createCustomSkin: (input: any) => ipcRenderer.invoke('custom-skin:create', input),
  deleteCustomSkin: (id: string) => ipcRenderer.invoke('custom-skin:delete', id),

  // 新闻
  fetchNews: (lang?: 'cn' | 'en') => ipcRenderer.invoke('news:fetch', lang),
  // 版本
  fetchVersion: () => ipcRenderer.invoke('version:fetch'),
  getClientUpdateStatus: () => ipcRenderer.invoke('client-update:get-status'),
  applyClientUpdate: () => ipcRenderer.invoke('client-update:apply'),
  onClientUpdateProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ClientUpdateProgress) => callback(progress);
    ipcRenderer.on('client-update:progress', handler);
    return () => ipcRenderer.removeListener('client-update:progress', handler);
  },
  // MOD 增量更新
  getModUpdateStatus: (war3Path: string) => ipcRenderer.invoke('mod-update:get-status', war3Path),
  applyModUpdate: (war3Path: string) => ipcRenderer.invoke('mod-update:apply', war3Path),
  onModUpdateProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ModUpdateProgress) => callback(progress);
    ipcRenderer.on('mod-update:progress', handler);
    return () => ipcRenderer.removeListener('mod-update:progress', handler);
  },
  getInstalledModState: (war3Path: string) => ipcRenderer.invoke('mod-update:get-installed-state', war3Path),
  verifyModIntegrity: (war3Path: string, fullHash = false) => ipcRenderer.invoke('mod-update:verify-integrity', war3Path, fullHash),

  // Mod Actions系统操作
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  showItemInFolder: (fullPath: string) => ipcRenderer.invoke('shell:showItemInFolder', fullPath),

  // 文件扫描和解压
  readDirectory: (dirPath: string) => ipcRenderer.invoke('file:readDir', dirPath),
  extractArchive: (archivePath: string, targetPath: string) => ipcRenderer.invoke('file:extractArchive', archivePath, targetPath),
  copyFiles: (sourcePattern: string, targetDir: string) => ipcRenderer.invoke('file:copyFiles', sourcePattern, targetDir),
  extractZip: (zipPath: string, extractPath: string) => ipcRenderer.invoke('file:extractZip', zipPath, extractPath),
  createZip: (sourceDir: string, outputPath: string) => ipcRenderer.invoke('file:createZip', sourceDir, outputPath),
  launchExecutable: (executablePath: string, args?: string[]) => ipcRenderer.invoke('file:launchExecutable', executablePath, args),
  downloadFile: (url: string, outputPath: string) => ipcRenderer.invoke('file:download', url, outputPath),
  getFileStats: (filePath: string) => ipcRenderer.invoke('file:getStats', filePath),
  // 已存在 readDirectory，移除重复定义

  // 注册表操作
  readRegistry: (keyPath: string, valueName: string) => ipcRenderer.invoke('registry:read', keyPath, valueName),
  writeRegistry: (keyPath: string, valueName: string, value: string, type?: string) => ipcRenderer.invoke('registry:write', keyPath, valueName, value, type),
  deleteRegistry: (keyPath: string, valueName?: string) => ipcRenderer.invoke('registry:delete', keyPath, valueName),
  registryExists: (keyPath: string, valueName?: string) => ipcRenderer.invoke('registry:exists', keyPath, valueName),
  listRegistry: (keyPath: string) => ipcRenderer.invoke('registry:list', keyPath),
  backupRegistry: (keyPath: string, backupPath: string) => ipcRenderer.invoke('registry:backup', keyPath, backupPath),
  restoreRegistry: (backupPath: string) => ipcRenderer.invoke('registry:restore', backupPath),

  // 窗口操作
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  showWindow: () => ipcRenderer.invoke('window:show'),
  setAlwaysOnTop: (flag: boolean) => ipcRenderer.invoke('window:setAlwaysOnTop', flag),
  getWindowState: () => ipcRenderer.invoke('window:getState'),
  setWindowSize: (width: number, height: number) => ipcRenderer.invoke('window:setSize', width, height),
  setWindowPosition: (x: number, y: number) => ipcRenderer.invoke('window:setPosition', x, y),
  centerWindow: () => ipcRenderer.invoke('window:center'),

  // 应用操作
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getAppPath: (name: string) => ipcRenderer.invoke('app:getPath', name),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),
  getSystemInfo: () => ipcRenderer.invoke('system:getInfo'),
  getDisplays: () => ipcRenderer.invoke('system:getDisplays'),
  setWindowIcon: (iconPath: string) => ipcRenderer.invoke('window:setIcon', iconPath),
  setWindowTitle: (title: string) => ipcRenderer.invoke('window:setTitle', title),
  flashFrame: (flag: boolean) => ipcRenderer.invoke('window:flashFrame', flag),
  setProgressBar: (progress: number) => ipcRenderer.invoke('window:setProgressBar', progress),
  setBadgeCount: (count: number) => ipcRenderer.invoke('app:setBadgeCount', count),

  // 系统操作
  executeCommand: (command: string) => ipcRenderer.invoke('system:exec', command),

  getFullPackageStatus: (war3Path?: string) => ipcRenderer.invoke('mod:get-full-package-status', war3Path),
  getInstallSpaceStatus: (zipPath?: string) => ipcRenderer.invoke('mod:install-space-status', zipPath),
  switchGameChannel: (channel: 'retail' | 'ptr') => ipcRenderer.invoke('game:switch-channel', channel),
  getBranchModStates: () => ipcRenderer.invoke('mod:get-branch-states'),
  setBranchModEnabled: (channel: 'retail' | 'ptr', enabled: boolean) => ipcRenderer.invoke('mod:set-branch-enabled', channel, enabled),
  installFullPackage: (zipPaths: string | string[]) => ipcRenderer.invoke('mod:install-full-package', zipPaths),
  syncAssets: (war3Path?: string) => ipcRenderer.invoke('mod:sync-assets', war3Path),

  // Mod Management
  deleteMod: (war3Path: string) => ipcRenderer.invoke('mod:delete', war3Path),
  resetRenderingComponents: (war3Path: string) => ipcRenderer.invoke('mod:reset-rendering', war3Path),
  toggleClassicMode: (war3Path: string, enable: boolean) => ipcRenderer.invoke('mod:toggle-classic-mode', war3Path, enable),
  getThirdPartyState: (war3Path: string) => ipcRenderer.invoke('third-party:get-state', war3Path),
  importThirdPartyZip: (war3Path: string, id: number, zipPath: string) => ipcRenderer.invoke('third-party:import-zip', war3Path, id, zipPath),
  importThirdPartyDirectory: (war3Path: string, id: number, directory: string) => ipcRenderer.invoke('third-party:import-directory', war3Path, id, directory),
  setThirdPartyEnabled: (war3Path: string, id: number, enabled: boolean) => ipcRenderer.invoke('third-party:set-enabled', war3Path, id, enabled),
  setThirdPartyFeature: (war3Path: string, id: number, featureId: string, enabled: boolean) => ipcRenderer.invoke('third-party:set-feature', war3Path, id, featureId, enabled),
  setThirdPartyName: (war3Path: string, id: number, name: string) => ipcRenderer.invoke('third-party:set-name', war3Path, id, name),

  // Classic Mode Skin System
  applyClassicSkin: (war3Path: string, change: any) => ipcRenderer.invoke('classic-skin:apply', war3Path, change),
  getClassicSupportedHeroes: (war3Path: string) => ipcRenderer.invoke('classic-skin:get-supported-heroes', war3Path)
};

// 通过contextBridge安全地暴露API
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// 暴露一些有用的常量
contextBridge.exposeInMainWorld('platform', {
  isWindows: process.platform === 'win32',
  isMacOS: process.platform === 'darwin',
  isLinux: process.platform === 'linux'
});

// 暴露版本信息
contextBridge.exposeInMainWorld('versions', {
  node: process.versions.node,
  chrome: process.versions.chrome,
  electron: process.versions.electron
});

// 监听主进程消息
ipcRenderer.on('show-about', () => {
  // 可以在这里触发渲染进程的事件
  window.dispatchEvent(new CustomEvent('electron-show-about'));
});

ipcRenderer.on('mod:install-progress', (event, data) => {
  window.dispatchEvent(new CustomEvent('mod-install-progress', { detail: data }));
});

ipcRenderer.on('mod:profile-progress', (_event, data) => {
  window.dispatchEvent(new CustomEvent('mod-profile-progress', { detail: data }));
});

ipcRenderer.on('anti-harmony:progress', (_event, data) => {
  window.dispatchEvent(new CustomEvent('anti-harmony-progress', { detail: data }));
});

// 错误处理
ipcRenderer.on('campaign:extract-progress', (event, data) => {
  window.dispatchEvent(new CustomEvent('campaign-extract-progress', { detail: data }));
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception in preload:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection in preload:', reason, promise);
});
