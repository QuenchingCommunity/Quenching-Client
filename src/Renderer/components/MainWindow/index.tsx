import React, { useState, useEffect, useCallback, useRef } from 'react';
import { afterResourceFirstPaint } from '../../../shared/resource-startup';
import { Button, Layout, Typography, message, Modal, Spin } from 'antd';
import {
  PlayCircleOutlined,
  SettingOutlined,
  BgColorsOutlined,
  QuestionCircleOutlined,
  InfoCircleOutlined,
  GlobalOutlined,
  CloseOutlined,
  MinusOutlined,
  ExclamationCircleOutlined,
  DownloadOutlined,
  FolderOpenOutlined
} from '@ant-design/icons';
import { useTranslation } from '../../utils/i18n';
import { useWar3Detector } from '../../hooks/useWar3Detector';
import { useWar3Settings, type ModSettings } from '../../hooks/useWar3Settings';
import { renderingPresetSettings, matchesRenderingPreset } from '../../../shared/rendering-presets';
import { useSound } from '../../hooks/useSound';
import { BackgroundVideo } from './BackgroundVideo';
import { LanguageSelector } from './LanguageSelector';
import SettingsModal from './SettingsModal';
import { CampaignModal } from './CampaignModal';
import { ThemeModal } from './ThemeModal';
import { AboutModal } from './AboutModal';
import { NewsPanel } from './NewsPanel';
import { SkinModal } from './SkinModal';
import { ThirdPartyModal } from './ThirdPartyModal';
import { FullPackageInstallModal } from './FullPackageInstallModal';
import { ForumPanel } from './ForumPanel';
import { useGlobalLoading } from '../GlobalLoadingProvider';
import { APP_VERSION } from '../../version';
import { IS_TEST_RELEASE } from '../../../shared/local-release';
import { isNewerClientVersion } from '../../../shared/client-version';
import { GameChannel, gameChannelFolder } from '../../../shared/game-channel';
import { GraphicsSelection, VersionSelection, isVersion30OrLater } from '../../../shared/mod-profile';
import { supportedWar3Version } from '../../../shared/war3-support';
import { activeSkinArtSet } from '../../../shared/active-skin-art-set';
import { buildCombinedUpdatePrompt, type CombinedUpdatePrompt } from '../../../shared/combined-update-prompt';
import { showUpdatePrompt, UPDATE_DIALOG_CLASS } from './UpdatePrompt';
import { reportUpdateFailure } from '../../utils/update-feedback';
// import styles from './MainWindow.module.less';

const { Content } = Layout;
const { Title, Text } = Typography;
const FULL_PACKAGE_GUIDE_URL = 'https://qm.txzy.net';
const openFullPackageGuide = () => window.electronAPI.openExternal(FULL_PACKAGE_GUIDE_URL);
const UPDATE_INITIAL_CHECK_DELAY_MS = 10_000;
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const UPDATE_FOCUS_RECHECK_MS = 5 * 60 * 1000;

// 临时样式对象，避免CSS模块加载问题
const styles: any = {
  mainWindow: 'main-window',
  titleBar: 'title-bar',
  titleBarLeft: 'title-bar-left',
  titleBarRight: 'title-bar-right',
  titleBarButton: 'title-bar-button',
  windowControls: 'window-controls',
  languageSelector: 'language-selector',
  backgroundVideo: 'background-video',
  centerContent: 'center-content',
  content: 'content',
  mainContent: 'main-content',
  logoSection: 'logo-section',
  logo: 'logo',
  titleSection: 'title-section',
  mainTitle: 'main-title',
  subtitle: 'subtitle',
  versionInfo: 'version-info',
  versionText: 'version-text',
  modeText: 'mode-text',
  warningText: 'warning-text',
  mainButtonSection: 'main-button-section',
  startButton: 'start-button',
  bottomSection: 'bottom-section',
  bottomLeft: 'bottom-left',
  bottomButtons: 'bottom-buttons',
  bottomButton: 'bottom-button',
  progressSection: 'progress-section',
  progressText: 'progress-text',
  progressBar: 'progress-bar',
  progressFill: 'progress-fill',
  progressPercent: 'progress-percent',
  disclaimer: 'disclaimer',
  designerCredit: 'designer-credit',
  newsPanel: 'news-panel',
  newsToggle: 'news-toggle',
  modalOverlay: 'modal-overlay',
  modal: 'modal',
  modalHeader: 'modal-header',
  modalContent: 'modal-content',
  modalFooter: 'modal-footer',
  settingsSection: 'settings-section',
  settingItem: 'setting-item',
  themeGrid: 'theme-grid',
  themeCard: 'theme-card',
  aboutContent: 'about-content',
  componentList: 'component-list',
  componentItem: 'component-item',
  selected: 'selected'
};

const PROFILE_STEP_FALLBACKS: Record<string, string> = {
  save: '正在保存这项设置',
  'write-graphics': '正在写入游戏画质偏好',
  'sync-start': '正在同步对应的 MOD 资源',
  environment: '正在同步环境资源',
  dnc: '正在同步昼夜光照',
  shaders: '正在同步着色器',
  skin: '正在切换可破坏物皮肤',
  layout: '正在整理画质目录',
  'layout-water': '正在应用水面布局',
  terrain: '正在应用地形',
  trees: '正在应用树木',
  water: '正在应用水面',
  finish: '正在完成这项设置',
};

const profileStepText = (step: string, translate: (key: string, fallback?: string) => string) =>
  translate(`msg.settings.step.${step}`, PROFILE_STEP_FALLBACKS[step] || '正在应用设置...');

const formatUpdateBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mib = bytes / 1024 ** 2;
  return mib >= 1024 ? `${(mib / 1024).toFixed(2)} GB` : `${mib.toFixed(mib >= 100 ? 0 : 1)} MB`;
};

export const MainWindow: React.FC = () => {
  const [launchingOfflineTest,setLaunchingOfflineTest]=useState(false);
  const { t } = useTranslation();
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isNewsPanelOpen, setIsNewsPanelOpen] = useState(false);
  const [installedModState, setInstalledModState] = useState<InstalledModState | null>(null);
  const [modUpdateStatus, setModUpdateStatus] = useState<ModUpdateStatus | null>(null);
  const [checkingModUpdate, setCheckingModUpdate] = useState(false);
  const [checkingFullPackageUpdate, setCheckingFullPackageUpdate] = useState(false);
  const [updatingMod, setUpdatingMod] = useState(false);
  const [modUpdateProgress, setModUpdateProgress] = useState<ModUpdateProgress | null>(null);
  const [clientUpdateVersion, setClientUpdateVersion] = useState('');
  const [clientUpdateStatus, setClientUpdateStatus] = useState<ClientUpdateStatus | null>(null);
  const [updatingClient, setUpdatingClient] = useState(false);
  const [clientUpdateProgress, setClientUpdateProgress] = useState<ClientUpdateProgress | null>(null);
  const [modUpdateChecked, setModUpdateChecked] = useState(false);
  const [clientUpdateChecked, setClientUpdateChecked] = useState(false);
  const modStatusRequestId = useRef(0);
  const clientStatusRequestId = useRef(0);
  const manualUpdateCheck = useRef(false);
  const updateStartupAt = useRef(Date.now());
  const promptedUpdateSignature = useRef('');
  const combinedUpdatePromptOpen = useRef(false);
  const { showLoading, hideLoading, updateLoading } = useGlobalLoading();
  const [resourcePreparation,setResourcePreparation]=useState<BundledResourceStartupStatus|null>(null);

  useEffect(()=>{
    const api=window.electronAPI;
    if(!api?.startBundledResourcePreparation)return;
    let active=true,lastRevision=-1;
    const receive=(status:BundledResourceStartupStatus)=>{
      if(!active || status.revision<lastRevision)return;
      lastRevision=status.revision;
      // Warm background checks never change another operation's loading dialog.
      setResourcePreparation(previous=>status.firstRun && status.phase==='preparing'?status:previous?null:previous);
    };
    const unsubscribe=api.onBundledResourceProgress?.(receive);
    const cancelPaint=afterResourceFirstPaint(window,()=>{
      if(active)void api.startBundledResourcePreparation().then(receive)
        .catch(error=>console.warn('[Resources] Startup handshake failed:',error));
    });
    return ()=>{active=false;cancelPaint();unsubscribe?.();};
  },[]);

  // War3 检测和MOD安装
  const {
    currentInstallation,
    isInWar3Directory,
    launchGame,
    detectInstallations
  } = useWar3Detector();


  const { modSettings, settings: war3Settings, saveModSettings, saveSettings, loadSettings, loadModSettings } = useWar3Settings();

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onStartupRenderingResult?.(result => {
      if (result.status === 'failed') {
        message.warning(`${t('settings.basic.resetRendering')}: ${result.error || t('msg.settings.save.failed')}`, 8);
      } else if (result.status === 'applied') {
        void window.electronAPI.getConfig('war3Path').then(path => {
          if (path) return loadModSettings(path);
        }).catch(error => console.warn('[StartupRendering] Could not refresh settings:', error));
      }
    });
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [t, loadModSettings]);

  const [isFullPackageInstalled, setIsFullPackageInstalled] = useState(false);
  const [installingFullPackage, setInstallingFullPackage] = useState(false);
  const [installWizardOpen, setInstallWizardOpen] = useState(false);
  const [modEnabledUI, setModEnabledUI] = useState(modSettings?.modEnabled ?? true);
  const [branchModStates, setBranchModStates] = useState<Record<GameChannel, { available: boolean; installed: boolean; enabled: boolean }> | null>(null);
  const [isModToggling, setIsModToggling] = useState(false);
  const [modToggleStatus, setModToggleStatus] = useState<{ message: string; percent: number } | null>(null);
  const [installProgress, setInstallProgress] = useState<{ message: string; percent: number } | null>(null);
  const [gameChannel, setGameChannel] = useState<GameChannel>('retail');
  const [switchingChannel, setSwitchingChannel] = useState(false);
  const [switchingGraphics, setSwitchingGraphics] = useState(false);
  const [applyStatus, setApplyStatus] = useState<{ title: string; detail: string; percent?: number } | null>(null);
  const [detectedVersion, setDetectedVersion] = useState('');
  const [installSpace, setInstallSpace] = useState<InstallSpaceStatus | null>(null);
  const [savedGamePath, setSavedGamePath] = useState('');
  const [choosingWar3Path, setChoosingWar3Path] = useState(false);
  const hasWar3Directory = !!savedGamePath && !!branchModStates?.[gameChannel]?.available;

  useEffect(() => {
    // The detector's first scan may run while the renderer is still mounting.
    // Independently restore the persisted path so a transient probe failure
    // never makes the home page look like the user's choice was forgotten.
    void window.electronAPI?.getConfig('war3Path')
      .then((value) => setSavedGamePath(value || ''))
      .catch((error) => console.warn('Could not read the saved Warcraft III directory:', error));
    void detectInstallations();
  }, []);

  useEffect(() => {
    if (!savedGamePath || currentInstallation) return;
    const retrySavedPath = () => { void detectInstallations(); };
    window.addEventListener('focus', retrySavedPath);
    return () => window.removeEventListener('focus', retrySavedPath);
  }, [savedGamePath, currentInstallation, detectInstallations]);

  const refreshInstallSpace = async () => {
    try {
      setInstallSpace(await window.electronAPI?.getInstallSpaceStatus?.() || null);
    } catch {
      setInstallSpace(null);
    }
  };

  const warnInsufficientInstallSpace = (space: InstallSpaceStatus) => {
    const gib = 1024 ** 3;
    message.warning(`${t('main.space.insufficient')} (${t('main.space.remaining')}: ${(space.freeBytes / gib).toFixed(1)} GiB; ${t('main.space.required')}: ${(space.requiredBytes / gib).toFixed(1)} GiB)`);
  };

  useEffect(() => {
    window.electronAPI?.getConfig('gameChannel').then((value) => {
      setGameChannel(value === 'ptr' ? 'ptr' : 'retail');
    });
  }, []);

  useEffect(() => {
    const handleProgress = (e: any) => {
      setInstallProgress(e.detail);
    };
    window.addEventListener('mod-install-progress', handleProgress);
    return () => window.removeEventListener('mod-install-progress', handleProgress);
  }, []);

  useEffect(() => window.electronAPI.onModUpdateProgress?.((progress) => {
    setModUpdateProgress(progress);
  }), []);

  const { playMain, playSmall, playHover } = useSound();

  // 同步全局 Loading 状态
  useEffect(() => {
    const handleProfileProgress = (event: Event) => {
      const detail = (event as CustomEvent<{ step?: string; percent?: number; operation?: string }>).detail;
      // The hook maps request-scoped substeps into the complete preset operation.
      if (!detail?.step || detail.operation) return;
      setApplyStatus((prev) => prev ? {
        ...prev,
        detail: profileStepText(detail.step, t),
        percent: detail.percent,
      } : prev);
    };
    window.addEventListener('mod-profile-progress', handleProfileProgress);
    return () => window.removeEventListener('mod-profile-progress', handleProfileProgress);
  }, [t]);

  useEffect(() => {
    if (resourcePreparation) {
      showLoading(t('resources.startup.title'),resourcePreparation.percent,t('resources.startup.detail'));
    } else if (isModToggling) {
      showLoading(modToggleStatus?.message || t('msg.settings.updating'), modToggleStatus?.percent);
    } else if (installingFullPackage) {
      showLoading(installProgress?.message || t('msg.install.full_package'), installProgress?.percent);
    } else if (updatingMod) {
      const byteDetail = modUpdateProgress?.totalBytes
        ? `${formatUpdateBytes(modUpdateProgress.completedBytes || 0)} / ${formatUpdateBytes(modUpdateProgress.totalBytes)}`
        : undefined;
      showLoading(
        modUpdateProgress?.message || t('msg.update.applying', '正在下载并安装 MOD 更新...'),
        modUpdateProgress?.percent ?? 0,
        byteDetail,
      );
    } else if (updatingClient) {
      const byteDetail = clientUpdateProgress?.totalBytes
        ? `${formatUpdateBytes(clientUpdateProgress.completedBytes || 0)} / ${formatUpdateBytes(clientUpdateProgress.totalBytes)}`
        : undefined;
      showLoading(
        t('msg.update.client_applying', '正在下载并安装客户端更新…'),
        clientUpdateProgress?.total ? Math.min(99, 99 * clientUpdateProgress.completed / clientUpdateProgress.total) : undefined,
        [clientUpdateProgress?.message, byteDetail].filter(Boolean).join(' · '),
      );
    } else if (switchingGraphics || switchingChannel) {
      showLoading(
        applyStatus?.title || t('msg.settings.updating'),
        applyStatus?.percent,
        applyStatus?.detail,
      );
    } else {
      hideLoading();
    }
  }, [resourcePreparation, isModToggling, modToggleStatus, installingFullPackage, installProgress, updatingMod, modUpdateProgress, updatingClient, clientUpdateProgress, switchingGraphics, switchingChannel, applyStatus, showLoading, hideLoading, t]);

  // 窗口控制
  const handleMinimize = useCallback(() => {
    // 立即响应，不等待IPC完成
    window.electronAPI?.minimizeWindow();
  }, []);

  const handleClose = useCallback(() => {
    playSmall(); // 退出使用 clicksmall
    window.electronAPI?.closeWindow();
  }, [playSmall]);

  const refreshFullPackageStatus = async (explicitPath?: string) => {
    const api = window.electronAPI;
    if (!api?.getFullPackageStatus) {
      setIsFullPackageInstalled(false);
      return;
    }

    let war3Path = explicitPath;

    if (!war3Path) {
      war3Path = currentInstallation?.path;

      if (!war3Path && api.getConfig) {
        war3Path = await api.getConfig('war3Path');
      }
    }

    if (!war3Path) {
      setIsFullPackageInstalled(false);
      return;
    }

    try {
      const installed = await api.getFullPackageStatus(war3Path);
      setIsFullPackageInstalled(!!installed);
    } catch (error: any) {
      setIsFullPackageInstalled(false);
      message.error(error?.message || String(error));
    }
  };

  const refreshBranchModStates = async () => {
    try {
      const configuredPath = currentInstallation?.path || await window.electronAPI.getConfig('war3Path');
      if (!configuredPath) {
        setBranchModStates(null);
        return;
      }
      setBranchModStates(await window.electronAPI.getBranchModStates());
    } catch {
      setBranchModStates(null);
    }
  };

  useEffect(() => {
    const onFocus = () => { void refreshBranchModStates(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [currentInstallation?.path]);

  const refreshModUpdateStatus = useCallback(async (war3Path: string): Promise<ModUpdateStatus | null> => {
    const requestId = ++modStatusRequestId.current;
    setCheckingModUpdate(true);
    try {
      const status = await window.electronAPI.getModUpdateStatus(war3Path);
      if (requestId === modStatusRequestId.current) {
        if (status.decision !== 'unavailable') setModUpdateStatus(status);
        setInstalledModState(status.current);
      }
      return status;
    } catch (error: any) {
      message.error(error?.message || String(error));
      return null;
    } finally {
      if (requestId === modStatusRequestId.current) setCheckingModUpdate(false);
    }
  }, []);

  useEffect(() => {
    refreshFullPackageStatus();
    void refreshBranchModStates();
    refreshInstallSpace();
    if (currentInstallation?.path) {
      console.log('[MainWindow] War3 installation detected, loading settings...', currentInstallation.path);
      loadSettings(currentInstallation.path);
    }
  }, [currentInstallation?.path, gameChannel]);

  useEffect(() => {
    modStatusRequestId.current += 1;
    setInstalledModState(null);
    setModUpdateStatus(null);
    setModUpdateChecked(false);
    const war3Path = currentInstallation?.path || savedGamePath;
    if (!war3Path) {
      setModUpdateChecked(true);
      return () => { modStatusRequestId.current += 1; };
    }

    let disposed = false;
    let inFlight = false;
    let lastCheckedAt = 0;
    let initialCheckStarted = false;
    const check = (force = false) => {
      if (disposed || inFlight || (!force && Date.now() - lastCheckedAt < UPDATE_FOCUS_RECHECK_MS)) return;
      lastCheckedAt = Date.now();
      inFlight = true;
      setModUpdateChecked(false);
      void refreshModUpdateStatus(war3Path).finally(() => {
        inFlight = false;
        if (!disposed) setModUpdateChecked(true);
      });
    };
    const startInitialCheck = () => {
      initialCheckStarted = true;
      check(true);
    };
    const onFocus = () => { if (initialCheckStarted) check(); };
    const onOnline = () => { if (initialCheckStarted) check(true); };
    const initialTimer = window.setTimeout(startInitialCheck,
      Math.max(0, UPDATE_INITIAL_CHECK_DELAY_MS - (Date.now() - updateStartupAt.current)));
    const interval = window.setInterval(() => check(true), UPDATE_CHECK_INTERVAL_MS);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      disposed = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      modStatusRequestId.current += 1;
    };
  }, [currentInstallation?.path, savedGamePath, gameChannel, refreshModUpdateStatus]);

  const refreshClientUpdateStatus = useCallback(async () => {
    const requestId = ++clientStatusRequestId.current;
    const status = await window.electronAPI.getClientUpdateStatus();
    let targetVersion = status.decision === 'available' || status.decision === 'incompatible' ? (status.targetVersion || '') : '';
    if (status.decision === 'unavailable') {
      const gateVersion = await window.electronAPI.fetchVersion().catch(() => '');
      if (isNewerClientVersion(gateVersion, status.currentVersion)) targetVersion = gateVersion;
    }
    if (requestId === clientStatusRequestId.current) {
      setClientUpdateStatus(status);
      setClientUpdateVersion(targetVersion);
    }
    return { status, targetVersion };
  }, []);

  useEffect(() => {
    setClientUpdateChecked(false);
    let disposed = false;
    let inFlight = false;
    let lastCheckedAt = 0;
    let initialCheckStarted = false;
    const check = (force = false) => {
      if (disposed || inFlight || (!force && Date.now() - lastCheckedAt < UPDATE_FOCUS_RECHECK_MS)) return;
      lastCheckedAt = Date.now();
      inFlight = true;
      setClientUpdateChecked(false);
      void refreshClientUpdateStatus()
        .catch(() => { /* Keep the last successful result until the next check. */ })
        .finally(() => {
          inFlight = false;
          if (!disposed) setClientUpdateChecked(true);
        });
    };
    const startInitialCheck = () => {
      initialCheckStarted = true;
      check(true);
    };
    const onFocus = () => { if (initialCheckStarted) check(); };
    const onOnline = () => { if (initialCheckStarted) check(true); };
    const initialTimer = window.setTimeout(startInitialCheck,
      Math.max(0, UPDATE_INITIAL_CHECK_DELAY_MS - (Date.now() - updateStartupAt.current)));
    const interval = window.setInterval(() => check(true), UPDATE_CHECK_INTERVAL_MS);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      disposed = true;
      clientStatusRequestId.current += 1;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [refreshClientUpdateStatus]);

  useEffect(() => window.electronAPI.onClientUpdateProgress(progress => {
    setClientUpdateProgress(progress);
  }), []);

  const showUpdateFailure = useCallback((error: unknown) => {
    Modal.error({
      className: UPDATE_DIALOG_CLASS,
      title: t('msg.update.incomplete', '更新未完成'),
      content: reportUpdateFailure(error, t),
      okText: t('common.close', '关闭'),
    });
  }, [t]);

  const applyClientUpdateNow = useCallback(async (): Promise<boolean> => {
    setClientUpdateProgress(null);
    setUpdatingClient(true);
    try {
      await window.electronAPI.applyClientUpdate();
      return true;
    } catch (error: any) {
      showUpdateFailure(error);
      setUpdatingClient(false);
      return false;
    }
  }, [showUpdateFailure]);


  useEffect(() => {
    let cancelled = false;
    setDetectedVersion('');
    if (currentInstallation?.path) {
      window.electronAPI?.detectWar3Version?.(currentInstallation.path)
        .then((info) => {
          if (!cancelled && info?.source !== 'unknown') setDetectedVersion(info.version || '');
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [currentInstallation?.path, gameChannel]);

  const handleChannelChange = (next: GameChannel) => {
    if (next === gameChannel || !branchModStates?.[next]?.available || switchingChannel || switchingGraphics || installingFullPackage || isModToggling || updatingMod || checkingFullPackageUpdate) return;
    Modal.confirm({
      centered: true,
      title: t('main.channel.confirm.title', 'Switch game branch'),
      content: t('main.channel.launchOnly', '只切换启动分支；Retail 与 PTR 的 MOD 安装状态不会改变。'),
      okText: t('main.channel.confirm.ok', 'Switch'),
      cancelText: t('main.channel.confirm.cancel', 'Cancel'),
      onOk: async () => {
        setApplyStatus({
          title: `${t('msg.settings.applying', '正在应用')}${t('main.channel.label', '游戏分支')}：${next === 'ptr' ? 'PTR' : 'Retail'}`,
          detail: t('main.channel.launchOnly', '只切换启动分支；Retail 与 PTR 的 MOD 安装状态不会改变。'),
        });
        setSwitchingChannel(true);
        try {
          await window.electronAPI.switchGameChannel(next);
          setGameChannel(next);
          if (currentInstallation?.path) await window.electronAPI.syncVersionedShaders(currentInstallation.path);
          await detectInstallations();
          await refreshFullPackageStatus();
          await refreshBranchModStates();
          await refreshInstallSpace();
          if (currentInstallation?.path) await loadSettings(currentInstallation.path);
        } catch (error: any) {
          message.error(`${t('main.channel.failed', 'Switch failed')}: ${error?.message || error}`);
        } finally {
          setSwitchingChannel(false);
          setApplyStatus(null);
        }
      },
    });
  };

  const graphicsMode = activeSkinArtSet(modSettings?.graphicsSelection, war3Settings?.hd, modSettings?.classicMode, war3Settings?.detectedGraphics);
  const selectedGraphics = modSettings.classicMode ? 'sd' : modSettings.graphicsSelection;
  const detectedVersionTier = supportedWar3Version(detectedVersion.split('.').map(Number));
  const handleProfileChange = async (selection: Partial<ModSettings>) => {
    if (switchingGraphics || switchingChannel || installingFullPackage || isModToggling || updatingMod) return;
    const war3Path = currentInstallation?.path || await window.electronAPI?.getConfig?.('war3Path');
    if (!war3Path) {
      message.warning(t('install.not_found'));
      return;
    }

    const nextVersion = selection.versionSelection ?? modSettings.versionSelection;
    const nextGraphics = selection.graphicsSelection ?? selectedGraphics;
    const deAllowed = isVersion30OrLater(nextVersion) || (nextVersion === 'auto' && isVersion30OrLater(detectedVersionTier));
    if (selection.graphicsSelection === 'de' && !deAllowed) return;
    // Switching to an older build must also leave DE in the same resource transition.
    const change: Partial<ModSettings> = nextGraphics === 'de' && !deAllowed
      ? { ...selection, graphicsSelection: 'hd' as const }
      : selection;
    // The retired Settings toggle parked whole asset directories. Migrate that
    // state as part of a Home profile change so HD/DE really restores them.
    if (modSettings.classicMode) {
      change.classicMode = false;
      if (selection.graphicsSelection === undefined) change.graphicsSelection = 'sd';
    }

    const versionLabel = (value: VersionSelection) => {
      if (value === 'auto') return t('main.home.auto', '自动检测');
      if (value === 'v204') return '2.04';
      if (value === 'v30') return '3.0';
      return t('main.home.v301', '最新（3.01）');
    };
    const graphicsLabel = (value: GraphicsSelection) => {
      if (value === 'sd') return t('main.home.sd', 'SD · 经典');
      if (value === 'de') return t('main.home.de', 'DE · 决定版');
      return t('main.home.hd', 'HD · 高清');
    };
    const named: string[] = [];
    if (change.versionSelection) named.push(`${t('main.home.gameVersion', '魔兽版本')}：${versionLabel(change.versionSelection)}`);
    if (change.graphicsSelection) named.push(`${t('main.home.graphics', '画质模式')}：${graphicsLabel(change.graphicsSelection)}`);
    setApplyStatus({
      title: named.length
        ? `${t('msg.settings.applying', '正在应用')}${named.join('，')}`
        : t('msg.settings.updating', '正在应用设置...'),
      detail: profileStepText('save', t),
      percent: 8,
    });
    setSwitchingGraphics(true);
    try {
      await saveModSettings(war3Path, change, (step, percent) => {
        setApplyStatus((prev) => prev ? { ...prev, detail: profileStepText(step, t), percent } : prev);
      });
      if (!modEnabledUI) {
        message.info(t('main.home.profileSavedForNextEnable', '设置已保存；启用 MOD 后会应用对应资源。'));
      } else {
        message.success(t('msg.settings.updated'));
      }
      await refreshFullPackageStatus(war3Path).catch(() => {});
    } catch (error: any) {
      message.error(`${t('msg.mod.failed')}: ${error?.message || error}`);
      // saveModSettings persists the selection before extraction. Restore the
      // previous UI/config if extraction failed instead of highlighting a pack
      // that was never applied.
      await window.electronAPI?.setConfig?.('modSettings', modSettings).catch(() => {});
      if (change.graphicsSelection !== undefined) {
        await saveSettings(war3Path, { hd: war3Settings.hd }).catch(() => {});
      }
      await loadSettings(war3Path).catch(() => {});
    } finally {
      setSwitchingGraphics(false);
      setApplyStatus(null);
    }
  };

  useEffect(() => {
    setModEnabledUI(branchModStates?.[gameChannel]?.enabled ?? false);
  }, [branchModStates, gameChannel]);

  const handleBranchModToggle = async (channel: GameChannel) => {
    if (choosingWar3Path || !hasWar3Directory || isModToggling || updatingMod || installingFullPackage) return;
    const enabled = !(branchModStates?.[channel]?.enabled ?? false);
    setIsModToggling(true);
    setModToggleStatus({ message: `${channel === 'ptr' ? 'PTR' : 'Retail'} MOD ${enabled ? '启用' : '关闭'}中…`, percent: 0 });
    try {
      const result = await window.electronAPI.setBranchModEnabled(channel, enabled);
      if (result.needsZip) {
        message.warning(t('main.home.basicModeHint', '无需完整包也能开启 MOD 基础功能；完整资源功能需另行安装。'));
        return;
      }
      setBranchModStates(result.states);
      if (enabled && channel === await window.electronAPI.getConfig('gameChannel')) {
        const root = await window.electronAPI.getConfig('war3Path');
        if (root) await window.electronAPI.syncUISettings(root);
      }
      await refreshFullPackageStatus();
      message.success(`${channel === 'ptr' ? 'PTR' : 'Retail'} MOD 已${enabled ? '启用' : '关闭'}`);
    } catch (error: any) {
      message.error(`${t('msg.mod.failed')}: ${error?.message || error}`);
    } finally {
      setIsModToggling(false);
      setModToggleStatus(null);
    }
  };

  // 启动游戏
  const handleStartGame = async () => {
    if (updatingMod) return;
    playMain();
    // 1. 尝试从 Config 获取路径
    let exePath = '';
    if (window.electronAPI?.getConfig) {
      const savedPath = await window.electronAPI.getConfig('war3Path');
      if (savedPath) {
        // 如果是文件夹，拼接可执行文件
        if (!savedPath.endsWith('.exe')) {
          // 简单的猜测逻辑，实际应复用 useWar3Detector 的逻辑
          exePath = savedPath.includes('Warcraft III.exe') ? savedPath : `${savedPath}/${gameChannelFolder(gameChannel)}/x86_64/Warcraft III.exe`;
        } else {
          exePath = savedPath;
        }
      }
    }

    // 2. 如果 Config 没有，尝试使用自动检测的 currentInstallation
    if (!exePath && currentInstallation) {
      exePath = currentInstallation.executablePath;
    }

    // 3. 如果都没有，弹出选择框
    if (!exePath) {
      // message.info('请选择魔兽争霸III安装目录');
      const path = await window.electronAPI?.selectGamePath();
      if (path) {
        // 保存后重新检测 (这里只是临时设置 exePath，UI 刷新依赖 Config 变更触发的重渲染或手动刷新)
        exePath = path.includes('.exe') ? path : `${path}/${gameChannelFolder(gameChannel)}/x86_64/Warcraft III.exe`;

        // 触发一次重新检测以更新界面状态
        detectInstallations();
        const selected = await window.electronAPI?.getConfig('gameChannel');
        setGameChannel(selected === 'ptr' ? 'ptr' : 'retail');
      } else {
        return; // 用户取消
      }
    }

    // 4. 执行启动
    try {
      if (window.electronAPI?.launchGame) {
        const selected = await window.electronAPI.getConfig('gameChannel');
        const channel: GameChannel = selected === 'ptr' ? 'ptr' : 'retail';
        const states = await window.electronAPI.getBranchModStates();
        setBranchModStates(states);
        if (!states[channel].available) {
          message.error(`${gameChannelFolder(channel)} ${t('main.channel.modMissing', '未安装')}`);
          return;
        }
        // 注意：launchGame 在 Main process 会优先读取 Config 中的 war3Path
        // 所以只要 selectGamePath 成功保存了 Config，这里直接调用即可
        await window.electronAPI.launchGame();
        message.success(t('msg.game.start.success'));
      }
    } catch (error) {
      hideLoading();
      message.error(`${t('msg.game.start.failed')}: ${error.message}`);
    }
  };

  const confirmInstallDirectory = async (): Promise<boolean> => {
    try {
      const path = await window.electronAPI.getConfig('war3Path');
      const selected = await window.electronAPI.getConfig('gameChannel');
      const channel: GameChannel = selected === 'ptr' ? 'ptr' : 'retail';
      const states = await window.electronAPI.getBranchModStates();
      setSavedGamePath(path || '');
      setGameChannel(channel);
      setBranchModStates(states);
      if (!path || !states[channel].available) {
        setIsFullPackageInstalled(false);
        message.warning(t('install.fullPackage.needDirectory'));
        return false;
      }
      void detectInstallations();
      void refreshFullPackageStatus(path);
      refreshInstallSpace();
      return true;
    } catch (error: any) {
      setBranchModStates(null);
      message.error(error?.message || t('install.fullPackage.needDirectory'));
      return false;
    }
  };

  const handleChangeWar3Path = async (): Promise<boolean> => {
    if (choosingWar3Path || isModToggling || updatingMod || checkingFullPackageUpdate || installingFullPackage || switchingGraphics || switchingChannel) return false;
    setChoosingWar3Path(true);
    try {
      if (!await window.electronAPI.selectGamePath()) return false;
      return await confirmInstallDirectory();
    } catch (error: any) {
      message.error(error?.message || t('install.fullPackage.needDirectory'));
      return false;
    } finally {
      setChoosingWar3Path(false);
    }
  };

  // 模态框控制
  const openModal = async (modalType: string) => {
    if (modalType === 'skin') {
      let configured = '';
      try { configured = await window.electronAPI.getConfig('war3Path') || ''; } catch {}
      const normalized = (value: string) => value.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
      const matches = !!configured && !!currentInstallation?.path && normalized(configured) === normalized(currentInstallation.path);
      let valid = false;
      if (matches && currentInstallation?.isValid) {
        try {
          valid = await window.electronAPI.pathExists(currentInstallation.executablePath) &&
            await window.electronAPI.pathExists(`${currentInstallation.path}/Data`);
        } catch {}
      }
      if (!valid) {
        message.warning(t('skin.panel.needGamePath', '请先在首页设置正确的魔兽争霸 III 目录，再打开涂装。'));
        void detectInstallations();
        return;
      }
    }
    // 检查 MOD 是否开启：涂装 and 设置按钮受限
    if (modalType === 'skin' || modalType === 'settings') {
      if (!modEnabledUI) {
        message.error(t('msg.mod.engine.required'));
        return;
      }
    }

    if (modalType === 'setup' && !currentInstallation) {
      message.warning(t('install.not_found'));
      detectInstallations();
      return;
    }
    playMain(); // 二级菜单入口使用 clickmain
    setActiveModal(modalType);
  };

  const closeModal = () => {
    setActiveModal(null);
  };


  // 音效播放
  const playHoverSound = () => {
    playHover();
  };

  const promptFullPackageGuide = useCallback((title: string, description: string) => {
    Modal.confirm({
      className: UPDATE_DIALOG_CLASS,
      title,
      content: description,
      okText: t('main.home.openFullPackageGuide', '获取资源包'),
      cancelText: t('main.home.later', '稍后'),
      onOk: openFullPackageGuide,
    });
  }, [t]);

  const handleModUpdate = useCallback(async (): Promise<boolean> => {
    if (updatingMod || checkingFullPackageUpdate || installingFullPackage || switchingGraphics || switchingChannel || isModToggling) return false;
    const war3Path = currentInstallation?.path || await window.electronAPI?.getConfig?.('war3Path');
    if (!war3Path) {
      message.warning(t('install.not_found'));
      return false;
    }

    setModUpdateProgress({ phase: 'preparing', percent: 0, message: '正在准备 MOD 更新' });
    setUpdatingMod(true);
    try {
      const status = await window.electronAPI.getModUpdateStatus(war3Path);
      setModUpdateStatus(status);
      if (status.current) setInstalledModState(status.current);

      if (status.decision === 'patch') {
        const result = await window.electronAPI.applyModUpdate(war3Path);
        if (!result.applied) {
          if (result.appliedPatches) {
            await refreshFullPackageStatus(war3Path);
            await refreshModUpdateStatus(war3Path);
          }
          throw new Error(result.error || result.status.reason);
        }
        if (result.configurationError) {
          Modal.warning({
            className: UPDATE_DIALOG_CLASS,
            title: t('msg.update.configuration_pending', 'MOD 已更新，但部分资源设置未生效'),
            content: result.configurationError,
          });
        } else {
          message.success(t('msg.update.success', 'MOD 已更新'));
        }
        await refreshFullPackageStatus(war3Path);
        await refreshModUpdateStatus(war3Path);
        return true;
      } else if (status.decision === 'requiresFullPackage') {
        promptFullPackageGuide(
          t('main.home.fullMissing', '需要安装完整版 MOD'),
          t('msg.update.full_required', '当前版本无法使用补丁，请下载完整版。')
        );
      } else if (status.decision === 'unknownInstallation') {
        promptFullPackageGuide(
          t('main.home.fullVersionUnknown', '无法确认完整版版本'),
          t('msg.update.unknown_install', '无法确认已安装版本，请重新安装完整版。')
        );
      } else if (status.decision === 'unavailable') {
        message.warning(t('msg.update.service_unavailable', '更新服务暂不可用，请稍后再试'));
      } else {
        message.success(t('msg.update.none_available', '你的版本是最新的'));
        return true;
      }
      return false;
    } catch (error: any) {
      showUpdateFailure(error);
      return false;
    } finally {
      setUpdatingMod(false);
      setModUpdateProgress(null);
    }
  }, [updatingMod, checkingFullPackageUpdate, installingFullPackage, switchingGraphics, switchingChannel,
    isModToggling, currentInstallation?.path, refreshFullPackageStatus, refreshModUpdateStatus,
    promptFullPackageGuide, showUpdateFailure, t]);

  const updatePromptBusy = updatingClient || updatingMod || installingFullPackage || installWizardOpen ||
    activeModal === 'forum' || choosingWar3Path || switchingGraphics || switchingChannel || isModToggling;

  const openCombinedUpdatePrompt = useCallback((prompt: CombinedUpdatePrompt, clientUpToDate: boolean) => {
    if (combinedUpdatePromptOpen.current) return;
    promptedUpdateSignature.current = prompt.signature;
    combinedUpdatePromptOpen.current = true;
    showUpdatePrompt({
      prompt, clientUpToDate, t,
      onConfirm: () => {
        void (async () => {
          if (prompt.mod?.automatic) {
            if (!await handleModUpdate()) return;
          } else if (prompt.mod) {
            await openFullPackageGuide();
          }
          if (prompt.client?.automatic) await applyClientUpdateNow();
          else if (prompt.client) await window.electronAPI.openExternal(FULL_PACKAGE_GUIDE_URL);
        })().catch(showUpdateFailure);
      },
      afterClose: () => { combinedUpdatePromptOpen.current = false; },
    });
  }, [t, handleModUpdate, applyClientUpdateNow, showUpdateFailure]);

  useEffect(() => {
    if (!clientUpdateChecked || !modUpdateChecked || combinedUpdatePromptOpen.current ||
        updatePromptBusy || checkingFullPackageUpdate || manualUpdateCheck.current) return;
    const prompt = buildCombinedUpdatePrompt(clientUpdateStatus, clientUpdateVersion, modUpdateStatus);
    if (prompt && promptedUpdateSignature.current !== prompt.signature) {
      openCombinedUpdatePrompt(prompt, clientUpdateStatus?.decision === 'upToDate');
    }
  }, [clientUpdateChecked, modUpdateChecked, clientUpdateStatus, clientUpdateVersion, modUpdateStatus,
    updatePromptBusy, checkingFullPackageUpdate, openCombinedUpdatePrompt]);

  const handleCheckUpdates = async () => {
    if (manualUpdateCheck.current || combinedUpdatePromptOpen.current || updatePromptBusy) return;
    manualUpdateCheck.current = true;
    setCheckingFullPackageUpdate(true);
    try {
      const war3Path = currentInstallation?.path || savedGamePath || await window.electronAPI.getConfig('war3Path');
      const [client, mod] = await Promise.all([
        refreshClientUpdateStatus(),
        war3Path ? refreshModUpdateStatus(war3Path) : Promise.resolve(null),
      ]);
      const prompt = buildCombinedUpdatePrompt(client.status, client.targetVersion, mod);
      // Explicit checks may reopen a version already dismissed by the player.
      if (prompt) openCombinedUpdatePrompt(prompt, client.status.decision === 'upToDate');
      else if (client.status.decision === 'unavailable' || client.status.decision === 'blocked' ||
          (war3Path && (!mod || mod.decision === 'unavailable'))) {
        message.warning(t('msg.update.service_unavailable', '更新服务暂不可用，请稍后再试'));
      } else if (war3Path && mod && !mod.current) {
        message.info(t('main.home.fullMissing', '完整版 MOD 尚未安装'));
      } else if (client.status.decision === 'upToDate' && (!war3Path || mod?.decision === 'upToDate')) {
        message.success(t('msg.update.none_available', '你的版本是最新的'));
      } else {
        message.warning(t('msg.update.service_unavailable', '更新服务暂不可用，请稍后再试'));
      }
    } catch (error) {
      showUpdateFailure(error);
    } finally {
      manualUpdateCheck.current = false;
      setCheckingFullPackageUpdate(false);
    }
  };

  const handleInstallFullPackage = async (source: 'zip' | 'folder'): Promise<boolean> => {
    if (!hasWar3Directory || choosingWar3Path || updatingMod || checkingFullPackageUpdate || installingFullPackage || switchingGraphics || switchingChannel) return false;
    if (!window.electronAPI?.installFullPackage) {
      return false;
    }

    try {
      const folder = source === 'folder'
        ? await window.electronAPI.selectDirectory(t('msg.install.select_folder')) : null;
      const zipPaths = source === 'folder' ? (folder ? [folder] : []) : await window.electronAPI.selectFiles({
        title: t('install.fullPackage.selectZip'),
        filters: [{ name: 'ZIP / RAR / 7z', extensions: ['zip', 'rar', '7z'] }]
      });

      if (!zipPaths.length) {
        return false;
      }

      setInstallingFullPackage(true);
      setInstallProgress(null);
      const result = await window.electronAPI.installFullPackage(zipPaths);

      if (result && result.success) {
        if (result.configurationError) {
          Modal.warning({
            title: t('msg.install.configuration_pending', '完整包已安装，但部分资源设置未生效'),
            content: result.configurationError,
          });
        } else if (result.skipped) {
          message.info(t('msg.install.already_installed'));
        } else {
          message.success(t('msg.install.success'));
        }
        const war3Path = await window.electronAPI.getConfig('war3Path');
        await refreshFullPackageStatus(war3Path);
        await refreshBranchModStates();
        if (war3Path) await refreshModUpdateStatus(war3Path);
        return true;
      } else if (result && result.error === 'incompletePackage') {
        await refreshFullPackageStatus();
        message.error(t('main.status.full_not_installed'));
      } else if (result && result.error === 'insufficientSpace') {
        const insufficientSpace = { freeBytes: result.freeBytes!, requiredBytes: result.requiredBytes!, insufficient: true, estimate: false };
        setInstallSpace(insufficientSpace);
        warnInsufficientInstallSpace(insufficientSpace);
      } else if (result && result.error === 'noWar3Path') {
        message.error(t('msg.install.no_path'));
      } else if (result && result.error === 'wrongChannel') {
        message.error(t('main.channel.wrong', 'Select the installed game branch first.'));
      } else if (result && result.error === 'noZip') {
        message.error(t('msg.install.invalid_zip'));
      } else {
        message.error(`${t('msg.install.failed')}: ${(result && result.error) || '未知错误'}`);
      }
    } catch (e: any) {
      message.error(`${t('msg.install.failed')}: ${e && e.message ? e.message : t('msg.install.invalid_zip')}`);
    } finally {
      setInstallingFullPackage(false);
      refreshInstallSpace();
    }
    return false;
  };

  const modUpdateAvailable = isFullPackageInstalled && modUpdateStatus?.current && modUpdateStatus.target &&
    modUpdateStatus.current.sequence < modUpdateStatus.target.sequence;

  return (
    <Layout
      className={styles.mainWindow}
      style={{
        width: '100vw',
        height: '100vh',
        background: '#000',
        position: 'relative',
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily: "'Trajan Pro 3', 'Microsoft YaHei UI Light', sans-serif"
      }}
    >
      {/* 背景视频 */}
      <BackgroundVideo paused={activeModal !== null} />

      {/* 窗口控制栏 */}
      <div
        className={styles.titleBar}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '40px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 15px',
          zIndex: 1000,
          // @ts-ignore
          WebkitAppRegion: 'drag'
        }}
      >
        <div
          className={styles.titleBarLeft}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            textShadow: '0 1px 1px rgba(0, 0, 0, 0.5), 0 0 5px rgba(0, 0, 0, 0.5)',
          }}
        >
          <Button
            type="text"
            icon={<QuestionCircleOutlined style={{
              filter: 'drop-shadow(1px 1px 2px rgba(0, 0, 0, 0.5))'
            }} />}
            className={styles.titleBarButton}
            onClick={() => openModal('about')}
          />

          <Button
            type="text"
            className={styles.titleBarButton}
            onClick={() => openModal('skin')}
            style={{ fontSize: '12px', textShadow: '0 1px 1px rgba(0, 0, 0, 0.2), 0 0 4px rgba(0, 0, 0, 0.6)', }}
          >
            {t('main.btn.skin')}
          </Button>

          <Button
            type="text"
            className={styles.titleBarButton}
            onClick={() => openModal('thirdParty')}
            style={{ fontSize: '12px', textShadow: '0 1px 1px rgba(0, 0, 0, 0.2), 0 0 4px rgba(0, 0, 0, 0.6)' }}
          >
            {t('main.btn.thirdParty')}
          </Button>

          <Button
            type="text"
            className={styles.titleBarButton}
            onClick={() => openModal('settings')}
            style={{ textShadow: '0 1px 1px rgba(0, 0, 0, 0.2), 0 0 4px rgba(0, 0, 0, 0.6)', fontSize: '12px' }}
          >
            {t('main.btn.settings')}
          </Button>

          <Button
            type="text"
            className={styles.titleBarButton}
            onClick={() => openModal('theme')}
            style={{ textShadow: '0 1px 1px rgba(0, 0, 0, 0.2), 0 0 4px rgba(0, 0, 0, 0.6)', fontSize: '12px' }}
          >
            {t('main.btn.theme')}
          </Button>

          <Button
            type="text"
            className={styles.titleBarButton}
            onClick={() => openModal('campaign')}
            style={{ textShadow: '0 1px 1px rgba(0, 0, 0, 0.2), 0 0 4px rgba(0, 0, 0, 0.6)', fontSize: '12px' }}
          >
            {t('main.btn.campaign')}
          </Button>

          <Button
            type="text"
            className={styles.titleBarButton}
            onClick={() => setIsNewsPanelOpen(!isNewsPanelOpen)}
            style={{ textShadow: '0 1px 1px rgba(0, 0, 0, 0.2), 0 0 4px rgba(0, 0, 0, 0.6)', fontSize: '12px' }}
          >
            {t('main.btn.news')}
          </Button>

          <Button
            type="text"
            className={styles.titleBarButton}
            onClick={() => openModal('about')}
            style={{ textShadow: '0 1px 1px rgba(0, 0, 0, 0.2), 0 0 4px rgba(0, 0, 0, 0.6)', fontSize: '12px' }}
          >
            {t('main.btn.about')}
          </Button>

          <Button type="text" className={styles.titleBarButton} onClick={() => void openModal('forum')}
            style={{ fontSize: '12px' }}>{t('main.btn.forum')}</Button>
          <LanguageSelector />
        </div>

        <div
          className={styles.titleBarRight}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}
        >
          <Button
            type="text"
            icon={<MinusOutlined />}
            className={styles.titleBarButton}
            onClick={handleMinimize}
          />
          <Button
            type="text"
            icon={<CloseOutlined />}
            className={styles.titleBarButton}
            onClick={handleClose}
          />
        </div>
      </div>

      <Content className="home-content" style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="home-shell">
          <section className="home-hero" aria-label={t('main.title.primary')}>
            <div className="home-hero-top">
              <span className="home-kicker">{t('main.title.secondary')}</span>
              <span className="home-channel-badge" title={[
                `${t('main.home.clientUpdateCurrent', '当前客户端')} ${APP_VERSION}`,
                installedModState && `${t('main.home.modVersion', 'MOD version')} v${(installedModState.displayVersion || installedModState.version).replace(/^v/i, '')}`,
              ].filter(Boolean).join(' · ')}>
                {APP_VERSION}
              </span>
            </div>
            <div className="home-brand">
              <div className={`home-logo-toggle ${modEnabledUI ? '' : 'is-off'}`}>
                <img src="./assets/quenching/logo.png" alt="" />
              </div>
              <div>
                <h1>{t('main.title.primary')}</h1>
                <p>{t('main.home.subtitle', 'Choose your game version and graphics profile before launching.')}</p>
                <span className="home-mod-state">{modEnabledUI ? t('main.home.modOn', 'Quenching MOD enabled') : t('main.home.modOff', 'Quenching MOD disabled')}</span>
              </div>
            </div>
            <div className="home-hero-status">
              <span className={`home-status-dot ${hasWar3Directory && isFullPackageInstalled ? 'is-ready' : ''}`} />
              <div className="home-directory-details">
                <strong>{hasWar3Directory
                  ? (isFullPackageInstalled ? t('main.status.full_installed') : t('main.status.full_not_installed'))
                  : t('main.status.no_war3')}</strong>
                <small>{savedGamePath || currentInstallation?.path || t('main.home.selectDirectory', 'Select your Warcraft III directory to begin.')}</small>
              </div>
              <button type="button" className="home-directory-choice"
                disabled={choosingWar3Path || isModToggling || updatingMod || checkingFullPackageUpdate || installingFullPackage || switchingGraphics || switchingChannel}
                onClick={() => void handleChangeWar3Path()}>
                <FolderOpenOutlined />
                {hasWar3Directory ? t('install.fullPackage.changeDirectory') : t('main.home.chooseWar3Directory')}
              </button>
            </div>
            <div className="home-hero-footer">
              <div className="home-hero-actions">
                <button type="button" className="home-mod-action" role="switch" aria-checked={modEnabledUI}
                  disabled={!hasWar3Directory || choosingWar3Path || isModToggling || switchingChannel || switchingGraphics || installingFullPackage || updatingMod}
                  onClick={() => void handleBranchModToggle(gameChannel)}>
                  {isModToggling ? t('main.home.switchingMod', '正在切换 MOD…')
                    : modEnabledUI ? t('main.home.disableMod', '关闭 MOD') : t('main.home.enableMod', '开启 MOD')}
                </button>
                <button type="button" className="home-install-full-package"
                  disabled={!hasWar3Directory || choosingWar3Path || updatingMod || checkingFullPackageUpdate || installingFullPackage || switchingGraphics || switchingChannel || isModToggling}
                  onClick={() => { playMain(); setInstallWizardOpen(true); }}>
                  <DownloadOutlined />
                  {installingFullPackage ? t('msg.install.installing')
                    : isFullPackageInstalled ? t('main.home.reinstallFullPackage') : t('main.home.installFullPackage')}
                </button>
              </div>
              <small className="home-mod-install-hint">{t('main.home.modInstallHint')}</small>
              {!isFullPackageInstalled && branchModStates?.[gameChannel]?.installed === false && installSpace?.insufficient && (
                <div className="home-space-warning" role="alert">
                  {installSpace.estimate ? t('main.space.low') : t('main.space.warning')}:
                  {' '}{(installSpace.freeBytes / 1024 ** 3).toFixed(1)} GiB {t('main.space.remaining')},
                  {' '}{t(installSpace.estimate ? 'main.space.reserve' : 'main.space.required')}
                  {' '}{(installSpace.requiredBytes / 1024 ** 3).toFixed(1)} GiB
                </div>
              )}
            </div>
          </section>

          <section className="home-control-card" aria-label={t('main.home.config', 'Launch configuration')}>
            <div className="home-card-heading">
              <div>
                <span className="home-kicker">{t('main.home.ready', 'READY TO PLAY')}</span>
                <h2>{t('main.home.config', 'Launch configuration')}</h2>
              </div>
              <span className="home-channel-badge">{gameChannel === 'ptr' ? 'PTR' : 'RETAIL'}</span>
            </div>

            {(clientUpdateVersion || modUpdateAvailable) && (
              <div className="home-update-notices" role="status" aria-live="polite">
                {clientUpdateVersion && (
                  <div className="home-update-notice">
                    <div>
                      <strong>{t('main.home.clientUpdateAvailable', '发现新版客户端')} · {clientUpdateVersion}</strong>
                      <small>{t('main.home.clientUpdateCurrent', '当前客户端')} {APP_VERSION}</small>
                    </div>
                    <div className="home-update-actions">
                      {clientUpdateStatus?.decision === 'available' && (
                        <button type="button" disabled={updatingClient || updatingMod || checkingFullPackageUpdate} onClick={() => void handleCheckUpdates()}>
                          {updatingClient ? (clientUpdateProgress?.message || '正在准备更新…') : checkingFullPackageUpdate ? t('msg.update.checking', '正在检查更新...') : '自动更新客户端'}
                        </button>
                      )}
                      {clientUpdateStatus?.decision !== 'available' && (
                        <button type="button" onClick={() => void handleCheckUpdates()}>
                          {t('main.home.downloadClient', '下载客户端')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {modUpdateAvailable && (
                  <div className="home-update-notice">
                    <div>
                      <strong>{t('main.home.fullUpdateAvailable', '发现新版 MOD')} · v{modUpdateStatus.target!.displayVersion.replace(/^v/i, '')}</strong>
                      <small>{t('main.home.modUpdateCurrent', '当前 MOD')} v{(modUpdateStatus.current!.displayVersion || modUpdateStatus.current!.version).replace(/^v/i, '')}</small>
                    </div>
                    <div className="home-update-actions">
                      {modUpdateStatus?.decision === 'patch' && (
                        <button type="button" disabled={updatingMod || installingFullPackage || switchingGraphics || switchingChannel}
                          onClick={() => void handleCheckUpdates()}>{t('main.home.applyModUpdate', '安装 MOD 更新')}</button>
                      )}
                      <button type="button" onClick={() => void openFullPackageGuide()}>
                        {t('main.home.viewFullPackage', '查看完整版')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="home-control-group">
              <div className="home-group-heading">
                <strong>01&nbsp; {t('main.channel.label')}</strong>
                <small>{t('main.channel.launchOnlyHint')}</small>
              </div>
              <div className="home-options home-options-branch" role="group" aria-label={t('main.channel.label')}>
                {(['retail', 'ptr'] as const).map((channel) => (
                  <button key={channel} type="button" className={`home-option ${gameChannel === channel ? 'is-active' : ''}`}
                    aria-pressed={gameChannel === channel}
                    disabled={!branchModStates?.[channel]?.available || switchingChannel || switchingGraphics || installingFullPackage || isModToggling || updatingMod}
                    onClick={() => handleChannelChange(channel)}>{channel === 'ptr' ? 'PTR' : 'Retail'}{branchModStates && !branchModStates[channel].available ? `（${t('main.channel.modMissing')}）` : ''}</button>
                ))}
              </div>
            </div>

            <div className="home-control-group">
              <div className="home-group-heading">
                <strong>02&nbsp; {t('main.home.gameVersion', 'Warcraft III version')}</strong>
                <small>{detectedVersion ? `${t('main.home.detected', 'Detected')}: ${detectedVersion}` : t('main.home.detectUnknown', 'Version not detected')}</small>
              </div>
              <div className="home-options home-options-version" role="group" aria-label={t('main.home.gameVersion', 'Warcraft III version')}>
                {([
                  ['auto', t('main.home.auto', 'Auto')],
                  ['v204', '2.04'],
                  ['v30', '3.0'],
                  ['v301', t('main.home.v301', 'Latest (3.01)')],
                ] as [VersionSelection, string][]).map(([value, label]) => (
                  <button key={value} type="button"
                    className={`home-option ${modSettings.versionSelection === value ? 'is-active' : ''}`}
                    aria-pressed={modSettings.versionSelection === value}
                    disabled={!currentInstallation || switchingGraphics || switchingChannel || installingFullPackage || isModToggling || updatingMod}
                    onClick={() => void handleProfileChange({ versionSelection: value })}>{label}</button>
                ))}
              </div>
            </div>

            <div className="home-control-group">
              <div className="home-group-heading">
                <strong>03&nbsp; {t('main.home.graphics', 'Graphics profile')}</strong>
                <small>{t('main.home.activeGraphics', 'Current')}: {graphicsMode.toUpperCase()}</small>
              </div>
              <div className="home-options home-options-graphics" role="group" aria-label={t('main.home.graphics', 'Graphics profile')}>
                {([
                  ['sd', t('main.home.sd', 'SD · Classic')],
                  ['hd', t('main.home.hd', 'HD · Reforged')],
                  ['de', t('main.home.de', 'DE · Definitive')],
                ] as [GraphicsSelection, string][]).map(([value, label]) => {
                  const deUnavailable = value === 'de' &&
                    !isVersion30OrLater(modSettings.versionSelection) &&
                    !(modSettings.versionSelection === 'auto' && isVersion30OrLater(detectedVersionTier));
                  return (
                    <button key={value} type="button"
                      className={`home-option ${selectedGraphics === value ? 'is-active' : ''}`}
                      aria-pressed={selectedGraphics === value}
                      title={deUnavailable ? t('main.home.deRequires30', 'DE requires Latest (3.01)') : undefined}
                      disabled={!currentInstallation || switchingGraphics || switchingChannel || installingFullPackage || isModToggling || updatingMod || deUnavailable}
                      onClick={() => void handleProfileChange({ graphicsSelection: value })}>{label}</button>
                  );
                })}
              </div>
              {selectedGraphics === 'de' && (
                <small className="home-profile-note">{t('main.home.deNote', 'DE uses the definitive resource set; classic mode is HD-only.')}</small>
              )}
            </div>

            <div className="home-control-group">
              <div className="home-group-heading">
                <strong>04&nbsp; {t('main.home.preset')}</strong>
              </div>
              <div className="home-options" role="group" aria-label={t('main.home.preset')}>
                {(['standard', 'battle'] as const).map(preset => (
                  <button key={preset} type="button"
                    className={`home-option ${matchesRenderingPreset(modSettings, preset) ? 'is-active' : ''}`}
                    aria-pressed={matchesRenderingPreset(modSettings, preset)}
                    disabled={!currentInstallation || selectedGraphics === 'sd' || switchingGraphics || switchingChannel || installingFullPackage || isModToggling || updatingMod || updatingClient}
                    onClick={() => void handleProfileChange(renderingPresetSettings(preset))}>
                    {t(preset === 'standard' ? 'main.home.preset.standard' : 'main.home.preset.battle')}
                  </button>
                ))}
              </div>
            </div>

            <div className="home-launch-row">
              <div className="home-install-actions">
                <button type="button" disabled={!currentInstallation || updatingMod || checkingModUpdate || checkingFullPackageUpdate || installingFullPackage || switchingGraphics || switchingChannel || isModToggling}
                  onClick={() => void handleCheckUpdates()}>
                  {updatingMod ? t('msg.update.applying', '正在下载并安装 MOD 更新...')
                    : checkingModUpdate ? t('msg.update.checking', '正在检查更新...')
                    : modUpdateStatus?.decision === 'patch' ? t('msg.update.download', '有新版本，点击自动更新')
                    : t('msg.update.check', '检查 MOD 更新')}
                </button>
                <button type="button" disabled={!currentInstallation || checkingFullPackageUpdate || checkingModUpdate || updatingMod || installingFullPackage || switchingGraphics || switchingChannel || isModToggling}
                  onClick={() => void handleCheckUpdates()}>
                  {checkingFullPackageUpdate ? t('msg.update.checking', '正在检查更新...') : t('main.home.checkFullPackageUpdate', '检查完整版更新')}
                </button>
              </div>
              <div className="home-launch-buttons">
              {IS_TEST_RELEASE && navigator.platform.startsWith('Win') && (
                <Button className="home-offline-test-button" loading={launchingOfflineTest}
                  disabled={launchingOfflineTest || !hasWar3Directory || gameChannel!=='retail' || installingFullPackage || switchingGraphics || switchingChannel || isModToggling || updatingMod || updatingClient}
                  title={t('main.offlineTest.hint')}
                  onClick={async()=>{
                    playMain();setLaunchingOfflineTest(true);
                    try{
                      if(!window.electronAPI?.launchOfflineStarterMap)throw new Error(t('main.offlineTest.unavailable'));
                      await window.electronAPI.launchOfflineStarterMap();
                      message.success(t('msg.game.start.success'));
                    }catch(error){message.error(`${t('msg.game.start.failed')}: ${error instanceof Error?error.message:String(error)}`);}
                    finally{setLaunchingOfflineTest(false);}
                  }}>{t('main.offlineTest.button')}</Button>
              )}
              <Button type="primary" icon={<PlayCircleOutlined />} className="home-launch-button"
                onClick={() => void handleStartGame()} onMouseEnter={playHoverSound}
                disabled={launchingOfflineTest || (!!branchModStates && !branchModStates[gameChannel].available) || installingFullPackage || switchingGraphics || switchingChannel || isModToggling || updatingMod}>
                {t('main.btn.start')}
              </Button>
              </div>
            </div>
          </section>
        </div>
        <div className="home-site-link">
          <button type="button" onClick={() => window.electronAPI?.openExternal('https://qm.txzy.net')}>qm.txzy.net</button>
        </div>
      </Content>

      {/* 新闻面板 */}
      <NewsPanel isExpanded={isNewsPanelOpen} onToggle={setIsNewsPanelOpen} />

      {/* 模态框 */}
      <ForumPanel open={activeModal === 'forum'} onClose={closeModal} />
      <FullPackageInstallModal open={installWizardOpen} onClose={() => setInstallWizardOpen(false)}
        war3Path={savedGamePath || currentInstallation?.path || ''} channel={gameChannel} installing={installingFullPackage}
        isFullPackageInstalled={isFullPackageInstalled}
        onChooseDirectory={handleChangeWar3Path} onConfirmDirectory={confirmInstallDirectory}
        onInstall={handleInstallFullPackage} onDownload={openFullPackageGuide} />
      <SettingsModal
        open={activeModal === 'settings'}
        onClose={closeModal}
        isFullPackageInstalled={isFullPackageInstalled}
        onModDeleteFinished={(deleted) => {
          if (deleted) {
            setModEnabledUI(false);
            setIsFullPackageInstalled(false);
            setBranchModStates(previous => previous ? {
              ...previous, [gameChannel]: { ...previous[gameChannel], installed: false, enabled: false },
            } : previous);
            setInstalledModState(null);
            setModUpdateStatus(null);
            closeModal();
          }
          void refreshFullPackageStatus();
          void refreshBranchModStates();
          if (currentInstallation?.path) void loadModSettings(currentInstallation.path);
        }}
      />

      <CampaignModal
        open={activeModal === 'campaign'}
        onClose={closeModal}
        war3RootPath={currentInstallation?.path}
        onRequestOpenSettings={() => setActiveModal('settings')}
      />

      <ThemeModal
        open={activeModal === 'theme'}
        onClose={closeModal}
      />

      <AboutModal
        open={activeModal === 'about'}
        onClose={closeModal}
      />


      <SkinModal
        open={activeModal === 'skin'}
        onClose={closeModal}
        isFullPackageInstalled={isFullPackageInstalled}
      />

      <ThirdPartyModal
        open={activeModal === 'thirdParty'}
        onClose={closeModal}
      />
    </Layout >
  );
};
