// Electron API类型定义

interface ClientUpdateStatus {
  decision: 'available' | 'upToDate' | 'blocked' | 'unavailable' | 'incompatible';
  currentVersion: string;
  targetVersion?: string;
  reason: string;
  downloadBytes?: number;
}

interface ClientUpdateProgress {
  message: string;
  completed: number;
  total: number;
  completedBytes?: number;
  totalBytes?: number;
}

interface StartupRenderingResult {
  status: 'applied' | 'skipped' | 'failed';
  reason?: string;
  error?: string;
}

type BundledResourceStartupStatus = import('../shared/resource-startup').ResourceStartupStatus;

interface ModUpdateProgress {
  phase: 'preparing' | 'downloading' | 'verifying' | 'extracting' | 'installing' | 'finalizing' | 'complete';
  percent: number;
  message: string;
  completedBytes?: number;
  totalBytes?: number;
}

interface ThirdPartyFeature {
  id: string;
  blocked: boolean;
  selected: boolean;
}

interface ThirdPartySlot {
  id: number;
  name: string;
  imported: boolean;
  enabled: boolean;
  stagingPath?: string;
  topLevel?: string[];
  features?: ThirdPartyFeature[];
}

interface ThirdPartyState {
  slots: ThirdPartySlot[];
  activeSlotId: number | null;
}

interface ElectronAPI {
  showForum: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
  setForumBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
  hideForum: () => Promise<void>;
  reloadForum: () => Promise<void>;
  getClientUpdateStatus: () => Promise<ClientUpdateStatus>;
  applyClientUpdate: () => Promise<{ restarting: boolean }>;
  onClientUpdateProgress: (callback: (progress: ClientUpdateProgress) => void) => () => void;
  // 文件操作
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<boolean>;
  copyFile: (sourcePath: string, targetPath: string) => Promise<boolean>;
  moveFile: (sourcePath: string, targetPath: string) => Promise<boolean>;
  moveDirectory: (sourceDir: string, targetDir: string) => Promise<boolean>;
  deleteFile: (filePath: string) => Promise<boolean>;
  pathExists: (filePath: string) => Promise<boolean>;
  getCurrentDirectory: () => Promise<string>;
  copyFiles: (sourcePattern: string, targetDir: string) => Promise<boolean>;
  extractZip: (zipPath: string, extractPath: string) => Promise<boolean>;
  extractArchive: (archivePath: string, extractPath: string) => Promise<boolean>;
  createZip: (sourceDir: string, outputPath: string) => Promise<boolean>;
  launchExecutable: (executablePath: string, args?: string[]) => Promise<boolean>;
  downloadFile: (url: string, outputPath: string) => Promise<boolean>;
  getFileStats: (filePath: string) => Promise<FileStats>;
  readDirectory: (dirPath: string) => Promise<DirectoryItem[]>;

  // 注册表操作
  readRegistry: (keyPath: string, valueName: string) => Promise<string | null>;
  writeRegistry: (keyPath: string, valueName: string, value: string, type?: string) => Promise<boolean>;
  deleteRegistry: (keyPath: string, valueName?: string) => Promise<boolean>;
  registryExists: (keyPath: string, valueName?: string) => Promise<boolean>;
  listRegistry: (keyPath: string) => Promise<RegistryValue[]>;
  backupRegistry: (keyPath: string, backupPath: string) => Promise<boolean>;
  restoreRegistry: (backupPath: string) => Promise<boolean>;

  // 窗口操作
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  hideWindow: () => Promise<void>;
  showWindow: () => Promise<void>;
  setAlwaysOnTop: (flag: boolean) => Promise<void>;
  getWindowState: () => Promise<WindowState>;
  setWindowSize: (width: number, height: number) => Promise<void>;
  setWindowPosition: (x: number, y: number) => Promise<void>;
  centerWindow: () => Promise<void>;
  openExternal: (url: string) => Promise<boolean>;
  showItemInFolder: (fullPath: string) => Promise<void>;

  // 应用操作
  getAppVersion: () => Promise<string>;
  getAppPath: (name: string) => Promise<string>;
  quitApp: () => Promise<void>;
  relaunchApp: () => Promise<void>;
  getSystemInfo: () => Promise<SystemInfo>;
  getDisplays: () => Promise<Display[]>;
  setWindowIcon: (iconPath: string) => Promise<void>;
  setWindowTitle: (title: string) => Promise<void>;
  flashFrame: (flag: boolean) => Promise<void>;
  setProgressBar: (progress: number) => Promise<void>;
  setBadgeCount: (count: number) => Promise<void>;

  // 系统操作
  executeCommand: (command: string) => Promise<{ stdout: string; stderr: string }>;

  // 游戏启动
  launchGame: (executablePath?: string) => Promise<boolean>;
  launchOfflineStarterMap?: () => Promise<boolean>;
  ensureLocalFiles: () => Promise<boolean>;
  startBundledResourcePreparation: () => Promise<BundledResourceStartupStatus>;
  onBundledResourceProgress: (callback:(status:BundledResourceStartupStatus)=>void) => () => void;
  onStartupRenderingResult: (callback: (result: StartupRenderingResult) => void) => () => void;
  launchMap: (mapPath: string, difficulty: number) => Promise<boolean>;
  unlockCampaign: (mapName?: string) => Promise<boolean>;
  getCampaignUnlockMode: () => Promise<'battlenet' | 'direct'>;
  extractCampaignW3n: (w3nPath: string) => Promise<{
    success: boolean;
    outputDir: string;
    maps: string[];
  }>;
  listInstalledCampaigns: () => Promise<{
    campaigns: Array<{
      id: string;
      path: string;
      mapCount: number;
      title?: string;
      difficulty?: string;
      author?: string;
      description?: string;
      maps?: Array<{
        path: string;
        chapter?: string;
        title?: string;
      }>;
    }>;
  }>;
  selectGamePath: () => Promise<string | null>;
  getConfig: (key: string) => Promise<any>;
  setConfig: (key: string, value: any) => Promise<void>;
  applyTheme: (themeId: string) => Promise<boolean>;
  updateMdlLighting: (
    war3Path: string,
    lightingMode: string,
    lightingBrightness?: number,
    previousLightingMode?: string,
    previousLightingBrightness?: number,
    requestId?: string,
  ) => Promise<boolean>;
  updateUISettings: (war3Path: string, uiMode: string) => Promise<boolean>;
  updateAtmosphericLight: (war3Path: string, enabled: boolean) => Promise<boolean>;
  updateRotatingLighting: (war3Path: string, enabled: boolean) => Promise<boolean>;
  updateLightingAngle: (war3Path: string, angle: number) => Promise<boolean>;
  syncUISettings: (war3Path: string) => Promise<boolean>;
  updateTerrainSettings: (war3Path: string, terrainMode: string, waterMode?: string, previousTerrainMode?: string, requestId?: string) => Promise<boolean>;
  updateTreeSettings: (war3Path: string, treeMode: string) => Promise<boolean>;
  updateWaterSettings: (war3Path: string, waterMode: string) => Promise<boolean>;
  updateFoliageSettings: (war3Path: string, enabled: boolean, terrainMode?: string, requestId?: string) => Promise<boolean>;
  updateBlightSettings: (war3Path: string, enabled: boolean) => Promise<boolean>;
  updateObjectShader: (war3Path: string, enabled: boolean) => Promise<boolean>;
  updatePostProcessing: (war3Path: string, enabled: boolean) => Promise<boolean>;
  updatePostProcessingGlow: (war3Path: string, enabled: boolean) => Promise<boolean>;
  updateHdr: (war3Path: string, enabled: boolean) => Promise<boolean>;
  updatePostProcessingOutline: (war3Path: string, enabled: boolean) => Promise<boolean>;
  /** @deprecated Always auto-syncs from War3 version; `enabled` ignored. */
  updateLegacyWar3Shader: (war3Path: string, enabled?: boolean) => Promise<boolean>;
  syncVersionedShaders: (war3Path?: string) => Promise<{
    success: boolean;
    zipName?: string;
    version?: {
      version: string;
      parts: number[];
      source: string;
    };
  }>;
  detectWar3Version: (war3Path?: string) => Promise<{
    version: string;
    parts: number[];
    source: string;
  }>;
  updateReadability: (war3Path: string, enabled: boolean) => Promise<boolean>;
  updateGlowSettings: (war3Path: string, enabled: boolean) => Promise<boolean>;
  getAntiHarmonyStatus: (war3Path?: string) => Promise<boolean>;
  setAntiHarmonyEnabled: (
    war3Path: string | undefined,
    enabled: boolean
  ) => Promise<{ success: boolean; enabled: boolean }>;
  installAntiHarmony: (war3Path?: string) => Promise<{
    success: boolean;
    enabled?: boolean;
  }>;
  updateHalfPortrait: (war3Path: string, visionModPath: string, enabled: boolean) => Promise<boolean>;
  updateModelEnhance: (war3Path: string, visionModPath: string, enabled: boolean) => Promise<boolean>;

  getFullPackageStatus: (war3Path?: string) => Promise<boolean>;
  getInstallSpaceStatus: (zipPath?: string) => Promise<InstallSpaceStatus | null>;
  switchGameChannel: (channel: 'retail' | 'ptr') => Promise<boolean>;
  getBranchModStates: () => Promise<Record<'retail' | 'ptr', { available: boolean; installed: boolean; enabled: boolean }>>;
  setBranchModEnabled: (channel: 'retail' | 'ptr', enabled: boolean) => Promise<{ needsZip: boolean; states: Record<'retail' | 'ptr', { available: boolean; installed: boolean; enabled: boolean }> }>;
  installFullPackage: (zipPaths: string | string[]) => Promise<FullPackageInstallResult>;
  syncAssets: (war3Path?: string) => Promise<void>;

  // Mod Management
  deleteMod: (war3Path: string) => Promise<{ success: boolean; removed: number; preserved: string[] }>;
  resetRenderingComponents: (war3Path: string) => Promise<{ success: boolean }>;
  toggleClassicMode: (war3Path: string, enable: boolean) => Promise<{ success: boolean; classicMode: boolean }>;
  getThirdPartyState: (war3Path: string) => Promise<ThirdPartyState>;
  importThirdPartyZip: (war3Path: string, id: number, zipPath: string) => Promise<ThirdPartyState>;
  importThirdPartyDirectory: (war3Path: string, id: number, directory: string) => Promise<ThirdPartyState>;
  setThirdPartyEnabled: (war3Path: string, id: number, enabled: boolean) => Promise<ThirdPartyState>;
  setThirdPartyFeature: (war3Path: string, id: number, featureId: string, enabled: boolean) => Promise<ThirdPartyState>;
  setThirdPartyName: (war3Path: string, id: number, name: string) => Promise<ThirdPartyState>;

  // Classic Mode Skin System
  applyClassicSkin: (war3Path: string, change: {
    heroId: string;
    skinData: {
      file?: string;
      modelScale?: string;
      modelScaleSD?: string;
      art?: string;
      unitSound?: string;
    };
  }) => Promise<{ success: boolean }>;
  getClassicSupportedHeroes: (war3Path: string) => Promise<string[]>;



  // 涂装系统
  applySkin: (unitId: string, changes: any[]) => Promise<boolean>;
  getVersionSkinPanel: (artSet: import('../shared/skin-versions').SkinArtSet) => Promise<{ selections: import('../shared/skin-versions').SkinSelections; originals: Record<string, import('../shared/skin-versions').VersionSkinChange[]> }>;
  applyVersionSkins: (artSet: import('../shared/skin-versions').SkinArtSet, choices: import('../shared/skin-versions').VersionSkinChoice[]) => Promise<import('../shared/skin-versions').SkinSelections>;
  applyBatchSkin: (batchChanges: any[]) => Promise<boolean>;
  disableSkins: () => Promise<boolean>;
  enableSkins: () => Promise<boolean>;
  isSkinEnabled: () => Promise<boolean>;
  getRetroSkinStatus: () => Promise<{
    unitsEnabled: boolean;
    buildingsEnabled: boolean;
    unitsDirName: string | null;
    buildingsDirName: string | null;
    unitskinExists: boolean;
  }>;
  applyRetroSkin: (options: { unitsEnabled?: boolean; buildingsEnabled?: boolean }) => Promise<{
    unitsEnabled: boolean;
    buildingsEnabled: boolean;
    unitsDirName: string | null;
    buildingsDirName: string | null;
    unitskinExists: boolean;
  }>;
  selectModelFile: () => Promise<string | null>;
  selectFile: (options: { title?: string, filters?: { name: string, extensions: string[] }[] }) => Promise<string | null>;
  selectFiles: (options: { title?: string, filters?: { name: string, extensions: string[] }[] }) => Promise<string[]>;
  selectDirectory: (title?: string) => Promise<string | null>;
  readModelResource: (path: string, basePath?: string, artSet?: 'sd' | 'hd' | 'de') => Promise<{
    data: string;
    mimeType: string;
    resolvedPath: string;
  }>;
  listCustomSkins: (targetId?: string) => Promise<CustomSkinRecord[]>;
  inspectCustomSkinModel: (modelPath: string, artSet?: 'sd' | 'hd' | 'de', portraitPath?: string) => Promise<{
    modelPath: string;
    references: string[];
    siblingCandidates: string[];
    unresolved: string[];
    textureBindings: Record<string, string>;
    gameReferences: string[];
    gameTextureBindings: Record<string, string>;
    portraitPath?: string;
  }>;
  createCustomSkin: (input: CreateCustomSkinInput) => Promise<CustomSkinRecord>;
  deleteCustomSkin: (id: string) => Promise<boolean>;

  // 新闻操作
  fetchNews: (lang?: 'cn' | 'en') => Promise<any[]>;
  fetchVersion: () => Promise<string>;

  // MOD 增量更新
  getModUpdateStatus: (war3Path: string) => Promise<ModUpdateStatus>;
  applyModUpdate: (war3Path: string) => Promise<ModUpdateResult>;
  onModUpdateProgress: (callback: (progress: ModUpdateProgress) => void) => () => void;
  getInstalledModState: (war3Path: string) => Promise<InstalledModState | null>;
  verifyModIntegrity: (war3Path: string, fullHash?: boolean) => Promise<ModIntegrityReport>;
}

interface ModUpdateArtifact {
  id?: string;
  size: number;
  sha256: string;
  sources: Array<string | { parts: Array<{ url: string; size: number; sha256: string }> }>;
}

interface ModPatchArtifact extends ModUpdateArtifact {
  fromSequence: number;
  toSequence: number;
}

interface InstalledModState {
  product: 'quenching-mod';
  sequence: number;
  version: string;
  displayVersion?: string;
  installedAt: string;
  files: string[];
  filesDigest: string;
}

interface ModUpdateStatus {
  decision: 'upToDate' | 'patch' | 'requiresFullPackage' | 'unknownInstallation' | 'unavailable';
  current: InstalledModState | null;
  target: { sequence: number; version: string; displayVersion: string } | null;
  patch?: ModPatchArtifact;
  patchChain?: import('../shared/mod-zip-update').ModZipPatch[];
  githubMirrors?: string[];
  fileSync?: import('../shared/file-sync').FileSyncDescriptor;
  fullPackage?: ModUpdateArtifact;
  reason: string;
  manifestSource?: string;
  integrity?: ModIntegrityReport;
}

interface ModIntegrityReport {
  ok: boolean;
  version: string | null;
  sequence: number | null;
  mode: 'presence' | 'full';
  expectedFiles: number;
  checkedFiles: number;
  missing: string[];
  sizeMismatch: string[];
  hashMismatch: string[];
  issueCount: number;
  issuesTruncated: boolean;
  source?: string;
  reason?: string;
}

interface ModUpdateResult {
  status: ModUpdateStatus;
  applied: boolean;
  downloadedFrom?: string;
  error?: string;
  configurationError?: string;
  appliedPatches?: number;
}

interface CustomSkinRecord {
  artSet: 'sd' | 'hd' | 'de';
  id: string;
  targetId: string;
  category: 'unit' | 'building' | 'hero';
  race?: string;
  name: string;
  source: 'game-paths' | 'external';
  config: { field: string; value: string }[];
  preview?: string;
  resourceDir?: string;
  createdAt: string;
  portraitAssociation?: import('../Main/services/skin-portrait').PortraitAssociation;
}

interface CreateCustomSkinInput {
  artSet: 'sd' | 'hd' | 'de';
  targetId: string;
  category: 'unit' | 'building' | 'hero';
  race?: string;
  name: string;
  source: 'game-paths' | 'external';
  modelPath?: string;
  modelPathHd?: string;
  portraitPath?: string;
  iconPath?: string;
  disabledIconPath?: string;
  unitSound?: string;
  textureBindings?: Record<string, string>;
}

interface FileStats {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  mtime: Date;
  ctime: Date;
}

interface DirectoryItem {
  name: string;
  path: string;
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtime: Date;
}

interface RegistryValue {
  name: string;
  type: string;
  value: string;
}

interface WindowState {
  isMaximized: boolean;
  isMinimized: boolean;
  isVisible: boolean;
  isFocused: boolean;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface SystemInfo {
  platform: string;
  arch: string;
  version: string;
  totalMemory: number;
  freeMemory: number;
  cpus: Array<{
    model: string;
    speed: number;
    times: {
      user: number;
      nice: number;
      sys: number;
      idle: number;
      irq: number;
    };
  }>;
  hostname: string;
  userInfo: {
    uid: number;
    gid: number;
    username: string;
    homedir: string;
    shell: string;
  };
}

interface Display {
  id: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  workArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  scaleFactor: number;
  rotation: number;
  internal: boolean;
}

interface FullPackageStatus {
  hasZip: boolean;
  alreadyInstalled: boolean;
  zipPath: string | null;
  installTarget: string | null;
}

interface FullPackageInstallResult {
  success: boolean;
  skipped?: boolean;
  error?: string;
  configurationError?: string;
  freeBytes?: number;
  requiredBytes?: number;
}

interface InstallSpaceStatus {
  freeBytes: number;
  requiredBytes: number;
  insufficient: boolean;
  estimate: boolean;
}

// 全局类型声明

interface Window {
  electronAPI: ElectronAPI;
}
