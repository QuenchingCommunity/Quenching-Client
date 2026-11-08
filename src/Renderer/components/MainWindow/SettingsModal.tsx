import {HDR_EXPOSURE_MIN,HDR_EXPOSURE_MAX,resolveHdrExposure} from '../../../shared/hdr-exposure';
import {unitShadowSliderValue} from '../../../shared/unit-light-settings';
import {VisionModules, visionBlocksSetting} from '../../../shared/vision-modules';
import React, { useState, useMemo, useEffect } from 'react';
import { Typography, Button, Space, Row, Col, message, Spin, Slider, InputNumber } from 'antd';
import { useTranslation } from '../../utils/i18n';
import { OverlayModal } from './OverlayModal';
import { useWar3Settings } from '../../hooks/useWar3Settings';
import { useWar3Detector } from '../../hooks/useWar3Detector';
import { useSound } from '../../hooks/useSound';
import { useGlobalLoading } from '../GlobalLoadingProvider';
import { normalizeGraphicsSelection } from '../../../shared/mod-profile';
import './LightingSettings.less';

const { Text } = Typography;

/** Basic tab: shared vertical rhythm (titles, desc, controls, status row). */
const BASIC_SETTINGS_TITLE: React.CSSProperties = {
  marginTop: 0,
  marginBottom: 6,
  fontSize: '16px',
  lineHeight: 1.35,
  fontFamily: "'Trajan Pro 3', serif",
  color: '#d4af37'
};
const BASIC_SETTINGS_TITLE_DANGER: React.CSSProperties = {
  ...BASIC_SETTINGS_TITLE,
  color: '#ff4d4f'
};
const BASIC_SETTINGS_DESC: React.CSSProperties = {
  color: '#888',
  fontSize: '12px',
  lineHeight: 1.45,
  margin: 0
};
const BASIC_SETTINGS_CONTROL_BTN: React.CSSProperties = {
  height: 36,
  fontSize: '13px',
  paddingInline: 18,
  alignSelf: 'flex-start'
};

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  isFullPackageInstalled?: boolean;
  onModDeleteFinished?: (deleted: boolean) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose, isFullPackageInstalled = false, onModDeleteFinished }) => {
  const { t } = useTranslation();
  const { modSettings, detectedVersion, settings: war3Settings, saveModSettings, toggleGameMode, isLoading } = useWar3Settings();
  // Applied profiles may belong to an earlier installation or game build.
  const effectiveVersion = modSettings.versionSelection === 'auto' ? detectedVersion : modSettings.versionSelection;
  const { currentInstallation, detectInstallations } = useWar3Detector();
  const { playSmall, playHover } = useSound();
  const { showLoading, hideLoading } = useGlobalLoading();
  const [visionModules,setVisionModules]=useState<VisionModules>({});
  useEffect(()=>{if(!open||!currentInstallation?.path)return;let active=true;window.electronAPI.getVisionModules(currentInstallation.path).then(value=>{if(active)setVisionModules(value);}).catch(()=>{if(active)setVisionModules({});});return()=>{active=false;};},[open,currentInstallation?.path]);
  const [selectedCategory, setSelectedCategory] = useState<'graphics' | 'game' | 'lighting' | 'basic'>('graphics');
  const [previewInfo, setPreviewInfo] = useState<{ title: string; desc: string; image: string | null }>({
    title: '',
    desc: t('settings.preview.default'),
    image: null
  });
  const isClassicMode = modSettings?.classicMode === true;
  // A previous applied DE profile must not lock an explicit HD selection.
  const deGraphics = !isClassicMode && normalizeGraphicsSelection(modSettings.graphicsSelection) === 'de';
  const visualSettingsDisabled = isClassicMode || modSettings?.graphicsSelection === 'sd';
  const [antiHarmonyEnabled, setAntiHarmonyEnabled] = useState(false);
  const [antiHarmonyBusy, setAntiHarmonyBusy] = useState(false);

  const categories = [
    { id: 'game', name: t('settings.category.game') },
    { id: 'graphics', name: t('settings.category.graphics') },
    { id: 'lighting', name: t('settings.category.lighting') },
    { id: 'basic', name: t('settings.basic.title') }
  ];

  const handleResetRendering = async () => {
    if (!currentInstallation?.path) return;
    try {
      showLoading(t('progress.hint'));
      await window.electronAPI?.resetRenderingComponents(currentInstallation.path);
      message.success(t('settings.basic.resetRendering.success'));
    } catch (e: any) {
      message.error(e.message || 'Error');
    } finally {
      hideLoading();
    }
  };

  const handleDeleteMod = async () => {
    if (!currentInstallation?.path) return;
    let deleted = false;
    try {
      showLoading(t('progress.hint'));
      const result = await window.electronAPI?.deleteMod(currentInstallation.path);
      if (!result?.success) throw new Error(t('msg.mod.failed'));
      deleted = true;
      if (result?.preserved?.length) {
        message.warning(`已删除 ${result.removed} 个 MOD 文件；保留 ${result.preserved.length} 个内容已修改的文件。`);
      } else {
        message.success(t('settings.basic.deleteMod.success'));
      }
      detectInstallations();
    } catch (e: any) {
      message.error(e.message || 'Error');
    } finally {
      hideLoading();
      onModDeleteFinished?.(deleted);
    }
  };

  useEffect(() => {
    if (!open || !currentInstallation?.path) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const enabled = await window.electronAPI?.getAntiHarmonyStatus?.(currentInstallation.path);
        if (!cancelled) {
          setAntiHarmonyEnabled(!!enabled);
        }
      } catch {
        if (!cancelled) {
          setAntiHarmonyEnabled(false);
        }
      }

    })();
    return () => {
      cancelled = true;
    };
  }, [open, currentInstallation?.path]);

  const handleAntiHarmonyChange = (enabled: boolean) => {
    if (!currentInstallation?.path || antiHarmonyBusy || visualSettingsDisabled) {
      return;
    }
    if (enabled === antiHarmonyEnabled) {
      return;
    }

    const war3Path = currentInstallation.path;
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent).detail as { percent?: number; message?: string } | undefined;
      const percent = typeof detail?.percent === 'number' ? detail.percent : undefined;
      showLoading(
        detail?.message
          ? `${t('settings.antiharmony.updating')} ${detail.message}`
          : t('settings.antiharmony.updating'),
        percent
      );
    };

    setTimeout(async () => {
      try {
        setAntiHarmonyBusy(true);
        showLoading(t('settings.antiharmony.updating'), 0);
        window.addEventListener('anti-harmony-progress', onProgress as EventListener);
        await window.electronAPI?.setAntiHarmonyEnabled?.(war3Path, enabled);
        setAntiHarmonyEnabled(enabled);
        message.success(enabled ? t('settings.antiharmony.success.on') : t('settings.antiharmony.success.off'));
      } catch (error) {
        console.error('Anti-harmony toggle failed:', error);
        const msg = error instanceof Error ? error.message : t('settings.antiharmony.failed');
        message.error(msg);
      } finally {
        window.removeEventListener('anti-harmony-progress', onProgress as EventListener);
        setAntiHarmonyBusy(false);
        hideLoading();
      }
    }, 0);
  };

  const handleSettingChange = async (key: string, value: any) => {
    console.log('[SettingsModal] handleSettingChange called:', key, value);
    if (!currentInstallation?.path) {
      console.warn('[SettingsModal] No War3 installation path found!');
      message.error(t('install.not_found'));
      return;
    }

    try {
      showLoading(t('msg.settings.updating'));
      console.log('[SettingsModal] Saving settings to:', currentInstallation.path);
      if (key === 'gameVersion') {
        // gameVersion 对应 War3Preferences.txt 中的 hd 字段
        await toggleGameMode(currentInstallation.path, value === 'reforged');
      } else {
        await saveModSettings(currentInstallation.path, { [key]: value });
      }
      message.success(t('msg.settings.updated'));
    } catch (error) {
      console.error('Failed to update setting:', error);
      const msg = error instanceof Error ? error.message : t('msg.mod.failed');
      message.error(msg);
    } finally {
      hideLoading();
    }
  };

  const renderSettingButton = (label: string, currentValue: any, targetValue: any, onClick: () => void, onMouseEnter?: () => void, disabled?: boolean) => {
    const isSelected = currentValue === targetValue;
    const isDisabled = isLoading || disabled;

    // 默认预览信息
    const defaultPreview = {
      title: '',
      desc: t('settings.preview.default'),
      image: null
    };

    return (
      <Button
        disabled={isDisabled}
        onClick={(e) => {
          e.currentTarget.blur();
          playSmall();
          onClick();
        }}
        onMouseEnter={() => {
          playHover();
          onMouseEnter?.();
        }}
        onMouseLeave={() => {
          setPreviewInfo(defaultPreview);
        }}
        style={{
          background: isSelected ? 'rgba(212, 175, 55, 0.3)' : 'rgba(0,0,0,0.5)',
          border: isSelected ? '1px solid #d4af37' : '1px solid rgba(212, 175, 55, 0.3)',
          color: isSelected ? '#fff' : '#aaa',
          fontSize: '12px',
          height: '28px',
          transition: 'all 0.2s',
          minWidth: '80px',
          opacity: isDisabled ? 0.4 : 1
        }}
      >
        {label}
      </Button>
    );
  };

  const renderSettingSwitch = (
    label: string,
    checked: boolean,
    onChange: (enabled: boolean) => void,
    onPreview?: () => void,
    disabled = false,
    stateLabel?: string,
  ) => (
    <div className="settings-switch-control"
      onMouseEnter={() => { playHover(); onPreview?.(); }}
      onMouseLeave={() => setPreviewInfo({ title: '', desc: t('settings.preview.default'), image: null })}>
      <button type="button" role="switch" aria-label={label} aria-checked={checked}
        className="settings-switch" disabled={isLoading || disabled}
        onFocus={() => onPreview?.()}
        onClick={(event) => {
          event.currentTarget.blur();
          playSmall();
          onChange(!checked);
        }}>
        <span className="settings-switch-thumb" aria-hidden="true" />
      </button>
      <span className="settings-switch-state">{stateLabel ?? t(checked ? 'settings.btn.turnon' : 'settings.btn.turnoff')}</span>
    </div>
  );

  const getSettingStatus = (key: string) => {
    if(visionBlocksSetting(visionModules,key))return {disabled:true,reason:t('settings.vision.managed')};
    // 1. Full Package Check (Highest Priority)
    const requiresFullPackage = ['water'];
    if (requiresFullPackage.includes(key) && !isFullPackageInstalled) {
      return { disabled: true, reason: t('main.status.full_not_installed') };
    }

    // 2. Classic Mode Check
    const restrictedInClassic = ['foliage', 'blight', 'objectShader', 'postProcessing', 'postProcessingGlow', 'postProcessingOutline', 'hdr', 'hdrExposure', 'half', 'modelEnhance', 'water', 'terrain', 'tree', 'lighting', 'lightingBrightness', 'lightingAngle', 'shadowLength', 'rotatingLighting', 'atmosphericLight', 'improveReadability', 'ui', 'glow'];
    if (restrictedInClassic.includes(key) && visualSettingsDisabled) {
      return { disabled: true, reason: t('settings.basic.classicMode.disabled') };
    }
    if (['hdr','hdrExposure'].includes(key) && effectiveVersion === 'v30') {
      return { disabled: true, reason: t('settings.hdr.unsupported') };
    }

    // 2b. DE graphics: water cannot be adjusted
    if (key === 'water') {
      if (deGraphics) {
        return { disabled: true, reason: t('settings.water.de.disabled') };
      }
    }

    // 3. VisionMod Check
    const requiresVisionMod = ['half', 'modelEnhance'];
    if (requiresVisionMod.includes(key) && !modSettings.visionModPath) {
      // Not Installed logic
      return { disabled: true, reason: t('settings.status.visionmod_required') };
    }

    // 4. Retro terrain: foliage not available
    if (key === 'foliage' && modSettings.terrain === 'retro') {
      return { disabled: true, reason: t('settings.foliage.retro.disabled') };
    }

    return { disabled: false, reason: null };
  };

  const getModResourceStatus = () => {
    if (!isFullPackageInstalled) {
      return { disabled: true, reason: t('main.status.full_not_installed') };
    }
    if (visualSettingsDisabled) {
      return { disabled: true, reason: t('settings.basic.classicMode.disabled') };
    }
    return { disabled: false, reason: null };
  };

  const renderStatusPlaceholder = (reason: string | null, tone: 'default' | 'danger' = 'default') => {
    const textColor = reason && tone === 'danger' ? '#ff4d4f' : '#666';
    return (
      <div className="settings-status-placeholder" style={{
        color: textColor,
        fontSize: '12px',
        marginTop: 4,
        minHeight: 20,
        lineHeight: '20px'
      }}>
        {reason || ''}
      </div>
    );
  };

  const renderGraphicsSettings = () => {
    // Helper to get status for each item
    const sFoliage = getSettingStatus('foliage');
    const sBlight = getSettingStatus('blight');
    const sShader = getSettingStatus('objectShader');
    const sPost = getSettingStatus('postProcessing');
    const sPostGlow = getSettingStatus('postProcessingGlow');
    const sOutline = getSettingStatus('postProcessingOutline');
    const sReadability = getSettingStatus('improveReadability');
    const readabilityAvailable = !visualSettingsDisabled &&
      effectiveVersion === 'v301' &&
      modSettings.objectShader && modSettings.postProcessing;
    const sGlow = getSettingStatus('glow');

    return (
      <div style={{ padding: '8px 0' }}>
        <Row className="settings-graphics-grid" gutter={[20, 24]}>

          <Col span={8}>
            <h3 style={{ color: '#d4af37', marginBottom: '10px', fontSize: '16px', fontFamily: "'Trajan Pro 3', serif" }}>{t('settings.foliage.title')}</h3>
            {renderSettingSwitch(t('settings.foliage.title'), Boolean(modSettings.foliage),
              enabled => handleSettingChange('foliage', enabled),
              Boolean(modSettings.foliage) ? (() => setPreviewInfo({ title: t('settings.foliage.title'), desc: t('settings.foliage.on.desc'), image: './assets/quenching/set4.png' })) : (() => setPreviewInfo({ title: t('settings.foliage.title'), desc: t('settings.foliage.off.desc'), image: './assets/quenching/set4.png' })),
              sFoliage.disabled)}
            {renderStatusPlaceholder(sFoliage.reason)}
          </Col>
          <Col span={8}>
            <h3 style={{ color: '#d4af37', marginBottom: '10px', fontSize: '16px', fontFamily: "'Trajan Pro 3', serif" }}>{t('settings.blight.title')}</h3>
            {renderSettingSwitch(t('settings.blight.title'), Boolean(modSettings.blight),
              enabled => handleSettingChange('blight', enabled),
              Boolean(modSettings.blight) ? (() => setPreviewInfo({ title: t('settings.blight.title'), desc: t('settings.blight.on.desc'), image: './assets/quenching/set6.png' })) : (() => setPreviewInfo({ title: t('settings.blight.title'), desc: t('settings.blight.off.desc'), image: './assets/quenching/set6.png' })),
              sBlight.disabled)}
            {renderStatusPlaceholder(sBlight.reason)}
          </Col>
          <Col span={8}>
            <h3 style={{ color: '#d4af37', marginBottom: '10px', fontSize: '16px', fontFamily: "'Trajan Pro 3', serif" }}>{t('settings.shader.title')}</h3>
            {renderSettingSwitch(t('settings.shader.title'), Boolean(modSettings.objectShader),
              enabled => handleSettingChange('objectShader', enabled),
              Boolean(modSettings.objectShader) ? (() => setPreviewInfo({ title: t('settings.shader.title'), desc: t('settings.shader.on.desc'), image: './assets/quenching/set5.png' })) : (() => setPreviewInfo({ title: t('settings.shader.title'), desc: t('settings.shader.off.desc'), image: './assets/quenching/set5.png' })),
              sShader.disabled)}
            {renderStatusPlaceholder(sShader.reason)}
          </Col>
          <Col span={8}>
            <h3 style={{ color: '#d4af37', marginBottom: '10px', fontSize: '16px', fontFamily: "'Trajan Pro 3', serif" }}>{t('settings.postprocessing.title')}</h3>
            {renderSettingSwitch(t('settings.postprocessing.title'), Boolean(modSettings.postProcessing),
              enabled => handleSettingChange('postProcessing', enabled),
              Boolean(modSettings.postProcessing) ? (() => setPreviewInfo({ title: t('settings.postprocessing.title'), desc: t('settings.postprocessing.on.desc'), image: './assets/quenching/set9.png' })) : (() => setPreviewInfo({ title: t('settings.postprocessing.title'), desc: t('settings.postprocessing.off.desc'), image: './assets/quenching/set9.png' })),
              sPost.disabled)}
            {renderStatusPlaceholder(sPost.reason)}
          </Col>
          <Col span={8}>
            <h3 style={{ color: '#d4af37', marginBottom: '10px', fontSize: '16px', fontFamily: "'Trajan Pro 3', serif" }}>{t('settings.postprocessing.outline.title')}</h3>
            {renderSettingSwitch(t('settings.postprocessing.outline.title'), Boolean(modSettings.postProcessingOutline ?? false),
              enabled => handleSettingChange('postProcessingOutline', enabled),
              () => setPreviewInfo({ title: t('settings.postprocessing.outline.title'), desc: t(modSettings.postProcessingOutline ? 'settings.postprocessing.outline.on.desc' : 'settings.postprocessing.outline.off.desc'), image: null }),
              sOutline.disabled || !modSettings.postProcessing || effectiveVersion !== 'v301')}
            {renderStatusPlaceholder(sOutline.reason)}
          </Col>
          <Col span={8}>
            <h3 style={{ color: '#d4af37', marginBottom: '10px', fontSize: '16px', fontFamily: "'Trajan Pro 3', serif" }}>{t('settings.postprocessing.glow.title', '后处理辉光')}</h3>
            {renderSettingSwitch(t('settings.postprocessing.glow.title', '后处理辉光'), Boolean(modSettings.postProcessingGlow),
              enabled => handleSettingChange('postProcessingGlow', enabled),
              Boolean(modSettings.postProcessingGlow) ? (() => setPreviewInfo({ title: t('settings.postprocessing.glow.title', '后处理辉光'), desc: t('settings.postprocessing.glow.on.desc', '只开启辉光，控制两份 Bloom 和 Gaussian Blur。'), image: './assets/quenching/set9.png' })) : (() => setPreviewInfo({ title: t('settings.postprocessing.glow.title', '后处理辉光'), desc: t('settings.postprocessing.glow.off.desc', '关闭后处理辉光。'), image: './assets/quenching/set9.png' })),
              sPostGlow.disabled)}
            {renderStatusPlaceholder(sPostGlow.reason)}
          </Col>
          <Col span={8}>
            <h3 style={{ color: '#d4af37', marginBottom: '10px', fontSize: '16px', fontFamily: "'Trajan Pro 3', serif" }}>{t('settings.readability.title')}</h3>
            {renderSettingSwitch(t('settings.readability.title'), Boolean(modSettings.improveReadability ?? false),
              enabled => handleSettingChange('improveReadability', enabled),
              () => setPreviewInfo({ title: t('settings.readability.title'), desc: t(modSettings.improveReadability ? 'settings.readability.on.desc' : 'settings.readability.off.desc'), image: null }),
              sReadability.disabled || !readabilityAvailable)}
          </Col>
          <Col span={8}>
            <h3 style={{ color: '#d4af37', marginBottom: '10px', fontSize: '16px', fontFamily: "'Trajan Pro 3', serif" }}>{t('settings.glow.title')}</h3>
            {renderSettingSwitch(t('settings.glow.title'), Boolean(modSettings.glow),
              enabled => handleSettingChange('glow', enabled),
              () => setPreviewInfo({ title: t('settings.glow.title'), desc: t(modSettings.glow ? 'settings.glow.weak.desc' : 'settings.glow.strong.desc'), image: './assets/quenching/ui4.png' }),
              sGlow.disabled,
              t(modSettings.glow ? 'settings.glow.weak' : 'settings.glow.strong'))}
            {renderStatusPlaceholder(sGlow.reason)}
          </Col>

          <Col span={8}>
            <h3 style={{ color: '#d4af37', marginBottom: '10px', fontSize: '16px', fontFamily: "'Trajan Pro 3', serif" }}>{t('settings.antiharmony.title')}</h3>
            {renderSettingSwitch(t('settings.antiharmony.title'), Boolean(antiHarmonyEnabled),
              enabled => handleAntiHarmonyChange(enabled),
              Boolean(antiHarmonyEnabled) ? (() =>
                  setPreviewInfo({
                    title: t('settings.antiharmony.title'),
                    desc: t('settings.antiharmony.on.desc'),
                    image: './assets/quenching/set7.png',
                  })) : (() =>
                  setPreviewInfo({
                    title: t('settings.antiharmony.title'),
                    desc: t('settings.antiharmony.off.desc'),
                    image: './assets/quenching/set7.png',
                  })),
              visualSettingsDisabled || antiHarmonyBusy)}
            {renderStatusPlaceholder(visualSettingsDisabled ? t('settings.basic.classicMode.disabled') : null)}
          </Col>
        </Row>
      </div>
    );
  };

  const renderGameSettings = () => {
    const sWater = getSettingStatus('water');
    const sTerrain = getSettingStatus('terrain');
    const sTree = getSettingStatus('tree');
    const sTerrainMod = getModResourceStatus();
    const sTreeMod = getModResourceStatus();
    const sUi = getSettingStatus('ui'); // not used yet but good to have

    return (
      <div style={{ padding: '16px', height: '100%', overflowY: 'auto' }}>
        <Row gutter={[16, 14]}>
          <Col span={24}>
            <h3 style={{ color: '#d4af37', marginBottom: '10px', fontSize: '16px', fontFamily: "'Trajan Pro 3', serif" }}>{t('settings.water.title')}</h3>
            <Space wrap>
              {renderSettingButton(t('settings.water.off'), modSettings.water, 'off', () => handleSettingChange('water', 'off'), () => setPreviewInfo({ title: t('settings.water.title'), desc: t('settings.water.off.desc'), image: './assets/quenching/set1.png' }), sWater.disabled)}
              {renderSettingButton(t('settings.water.realistic'), modSettings.water, 'realistic', () => handleSettingChange('water', 'realistic'), () => setPreviewInfo({ title: t('settings.water.title'), desc: t('settings.water.realistic.desc'), image: './assets/quenching/set1.png' }), sWater.disabled)}
              {renderSettingButton(t('settings.water.transparent'), modSettings.water, 'transparent', () => handleSettingChange('water', 'transparent'), () => setPreviewInfo({ title: t('settings.water.title'), desc: t('settings.water.transparent.desc'), image: './assets/quenching/set1.png' }), sWater.disabled)}
            </Space>
            {renderStatusPlaceholder(sWater.reason)}
          </Col>
          <Col span={24}>
            <h3 style={{ color: '#d4af37', marginBottom: '10px', fontSize: '16px', fontFamily: "'Trajan Pro 3', serif" }}>{t('settings.ui.style')}</h3>
            <Space wrap>

              {renderSettingButton(t('settings.ui.classic'), modSettings.ui, 'classic', () => handleSettingChange('ui', 'classic'), () => setPreviewInfo({ title: t('settings.ui.style'), desc: t('settings.ui.classic.desc'), image: './assets/quenching/ui1.png' }), sUi.disabled)}
              {renderSettingButton(t('settings.ui.quenching'), modSettings.ui, 'quenching', () => handleSettingChange('ui', 'quenching'), () => setPreviewInfo({ title: t('settings.ui.style'), desc: t('settings.ui.quenching.desc'), image: './assets/quenching/ui2.png' }), sUi.disabled)}
              {renderSettingButton(t('settings.ui.blizzard'), modSettings.ui, 'carnival', () => handleSettingChange('ui', 'carnival'), () => setPreviewInfo({ title: t('settings.ui.style'), desc: t('settings.ui.blizzard.desc'), image: './assets/quenching/ui3.png' }), sUi.disabled)}
            </Space>
            {renderStatusPlaceholder(sUi.reason)}
          </Col>
          <Col span={24}>
            <h3 style={{ color: '#d4af37', marginBottom: '10px', fontSize: '16px', fontFamily: "'Trajan Pro 3', serif" }}>{t('settings.terrain.style')}</h3>
            <Space wrap>
              {renderSettingButton(t('settings.terrain.original'), modSettings.terrain, 'original', () => handleSettingChange('terrain', 'original'), () => setPreviewInfo({ title: t('settings.terrain.style'), desc: t('settings.terrain.original.desc'), image: './assets/quenching/set6.png' }), sTerrain.disabled)}
              {renderSettingButton(t('settings.terrain.decisive'), modSettings.terrain, 'decisive', () => handleSettingChange('terrain', 'decisive'), () => setPreviewInfo({ title: t('settings.terrain.style'), desc: t('settings.terrain.decisive.desc'), image: './assets/quenching/set6.png' }), sTerrainMod.disabled || sTerrain.disabled)}
              {renderSettingButton(t('settings.terrain.latest'), modSettings.terrain, 'latest', () => handleSettingChange('terrain', 'latest'), () => setPreviewInfo({ title: t('settings.terrain.style'), desc: t('settings.terrain.latest.desc'), image: './assets/quenching/set6.png' }), sTerrainMod.disabled || sTerrain.disabled)}
              {renderSettingButton(t('settings.tree.height.16'), modSettings.terrain, 'v16', () => handleSettingChange('terrain', 'v16'), () => setPreviewInfo({ title: t('settings.terrain.style'), desc: t('settings.terrain.v16.desc'), image: './assets/quenching/set6.png' }), sTerrainMod.disabled || sTerrain.disabled)}
              {renderSettingButton(t('settings.tree.height.18'), modSettings.terrain, 'v18', () => handleSettingChange('terrain', 'v18'), () => setPreviewInfo({ title: t('settings.terrain.style'), desc: t('settings.terrain.v18.desc'), image: './assets/quenching/set6.png' }), sTerrainMod.disabled || sTerrain.disabled)}
              {renderSettingButton(t('settings.terrain.retro'), modSettings.terrain, 'retro', () => handleSettingChange('terrain', 'retro'), () => setPreviewInfo({ title: t('settings.terrain.style'), desc: t('settings.terrain.retro.desc'), image: './assets/quenching/set6.png' }), sTerrainMod.disabled || sTerrain.disabled)}
            </Space>
            {renderStatusPlaceholder(sTerrainMod.reason || sTerrain.reason)}
          </Col>
          <Col span={24}>
            <h3 style={{ color: '#d4af37', marginBottom: '10px', fontSize: '16px', fontFamily: "'Trajan Pro 3', serif" }}>{t('settings.tree.style')}</h3>
            <Space wrap>
              {renderSettingButton(t('settings.tree.original'), modSettings.tree, 'original', () => handleSettingChange('tree', 'original'), () => setPreviewInfo({ title: t('settings.tree.style'), desc: t('settings.tree.original.desc'), image: './assets/quenching/set2.png' }), sTree.disabled)}
              {renderSettingButton(t('settings.tree.tall'), modSettings.tree, 'tall', () => handleSettingChange('tree', 'tall'), () => setPreviewInfo({ title: t('settings.tree.style'), desc: t('settings.tree.tall.desc'), image: './assets/quenching/set2.png' }), sTreeMod.disabled || sTree.disabled)}
              {renderSettingButton(t('settings.tree.short'), modSettings.tree, 'short', () => handleSettingChange('tree', 'short'), () => setPreviewInfo({ title: t('settings.tree.style'), desc: t('settings.tree.short.desc'), image: './assets/quenching/set2.png' }), sTreeMod.disabled || sTree.disabled)}
              {renderSettingButton(t('settings.tree.height.18'), modSettings.tree, 'v18', () => handleSettingChange('tree', 'v18'), () => setPreviewInfo({ title: t('settings.tree.style'), desc: t('settings.tree.v18.desc'), image: './assets/quenching/set2.png' }), sTreeMod.disabled || sTree.disabled)}
              {renderSettingButton(t('settings.tree.height.16'), modSettings.tree, 'v16', () => handleSettingChange('tree', 'v16'), () => setPreviewInfo({ title: t('settings.tree.style'), desc: t('settings.tree.v16.desc'), image: './assets/quenching/set2.png' }), sTreeMod.disabled || sTree.disabled)}
              {renderSettingButton(t('settings.tree.retro'), modSettings.tree, 'retro', () => handleSettingChange('tree', 'retro'), () => setPreviewInfo({ title: t('settings.tree.style'), desc: t('settings.tree.retro.desc'), image: './assets/quenching/set2.png' }), sTreeMod.disabled || sTree.disabled)}
            </Space>
            {renderStatusPlaceholder(sTreeMod.reason || sTree.reason)}
          </Col>

        </Row>
      </div>
    );
  };

  const [lightingAngleDraft, setLightingAngleDraft] = useState<number|null>(modSettings.lightingAngle ?? null);
  useEffect(() => { setLightingAngleDraft(modSettings.lightingAngle ?? null); }, [modSettings.lightingAngle,open]);
  const commitLightingAngle = (angle: number) => {
    if (angle !== modSettings.lightingAngle) void handleSettingChange('lightingAngle', angle);
  };
  const [shadowLengthDraft,setShadowLengthDraft]=useState<number|null>(unitShadowSliderValue(modSettings.shadowLength));
  useEffect(()=>{setShadowLengthDraft(unitShadowSliderValue(modSettings.shadowLength));},[modSettings.shadowLength,open]);
  const commitShadowLength=(value:number)=>{
    if(value!==unitShadowSliderValue(modSettings.shadowLength))void handleSettingChange('shadowLength',value);
  };
  const [hdrExposureDraft,setHdrExposureDraft]=useState(resolveHdrExposure(modSettings));
  useEffect(()=>{setHdrExposureDraft(resolveHdrExposure(modSettings));},[modSettings.hdrExposure,modSettings.lighting,open]);
  const commitHdrExposure=(value:number)=>{if(value!==resolveHdrExposure(modSettings))void handleSettingChange('hdrExposure',value);};
  const renderLightingSettings = () => {
    const sHdr=getSettingStatus('hdr');
    const sExposure=getSettingStatus('hdrExposure');
    const sAtmospheric = getSettingStatus('atmosphericLight');
    const sRotating = getSettingStatus('rotatingLighting');
    const sLighting = getSettingStatus('lighting');
    const sLightingBrightness = getSettingStatus('lightingBrightness');
    const sAngle = getSettingStatus('lightingAngle');
    if(modSettings.rotatingLighting===true)sAngle.disabled=true;
    const sShadowLength = getSettingStatus('shadowLength');
    if(modSettings.rotatingLighting===true)sShadowLength.disabled=true;
    return <div className="settings-lighting"><Row gutter={[32, 22]}>
          <Col xs={12} md={8}>
            <h3 style={{ color: '#d4af37', marginBottom: '10px', fontSize: '16px', fontFamily: "'Trajan Pro 3', serif" }}>{t('settings.rotatingLighting.title')}</h3>
            {renderSettingSwitch(t('settings.rotatingLighting.title'), modSettings.rotatingLighting === true,
              enabled => handleSettingChange('rotatingLighting', enabled),
              undefined,
              sRotating.disabled)}
            {renderStatusPlaceholder(sRotating.reason || t('settings.experimental'))}
          </Col>
          <Col xs={12} md={8}>
            <h3 style={BASIC_SETTINGS_TITLE}>{t('settings.atmosphericLight.title')}</h3>
            {renderSettingSwitch(t('settings.atmosphericLight.title'),modSettings.atmosphericLight===true,
              enabled=>handleSettingChange('atmosphericLight',enabled),
              undefined,sAtmospheric.disabled)}
            {renderStatusPlaceholder(sAtmospheric.reason)}
          </Col>
          <Col span={24}>
            <h3 style={{ color: '#d4af37', marginBottom: '10px', fontSize: '16px', fontFamily: "'Trajan Pro 3', serif" }}>{t('settings.lighting')}</h3>
            <Space wrap>
              {renderSettingButton(t('settings.lighting.standard'), modSettings.lighting, 'standard', () => handleSettingChange('lighting', 'standard'), undefined, sLighting.disabled)}
              {renderSettingButton(t('settings.lighting.rpg'), modSettings.lighting, 'rpg', () => handleSettingChange('lighting', 'rpg'), undefined, sLighting.disabled)}
              {renderSettingButton(t('settings.lighting.level4'), modSettings.lighting, 'battle', () => handleSettingChange('lighting', 'battle'), undefined, sLighting.disabled)}
            </Space>
            {renderStatusPlaceholder(sLighting.reason)}

          </Col>
      <Col span={24}>
        <div className="settings-hdr-row">
          <div className="settings-hdr-toggle">
            <h3 style={BASIC_SETTINGS_TITLE}>{t('settings.hdr.title')}</h3>
            {renderSettingSwitch(t('settings.hdr.title'),Boolean(modSettings.hdr),enabled=>handleSettingChange('hdr',enabled),
              undefined,sHdr.disabled)}
            {renderStatusPlaceholder(sHdr.reason)}
          </div>
          {modSettings.hdr && <div className="settings-hdr-exposure">
            <h3 style={BASIC_SETTINGS_TITLE}>{t('settings.hdr.brightness')}</h3>
            <Slider min={HDR_EXPOSURE_MIN} max={HDR_EXPOSURE_MAX} step={0.01} value={hdrExposureDraft}
              aria-label={t('settings.hdr.brightness')} disabled={sExposure.disabled||isLoading}
              marks={{[HDR_EXPOSURE_MIN]:t('settings.hdr.minimum'),[HDR_EXPOSURE_MAX]:t('settings.hdr.maximum')}}
              tooltip={{open:false}}
              onChange={setHdrExposureDraft} onChangeComplete={commitHdrExposure}/>
            {renderStatusPlaceholder(sExposure.reason)}
          </div>}
        </div>
      </Col>
      <Col span={24}>
            <h3 style={BASIC_SETTINGS_TITLE}>{t('settings.lighting.strength')}</h3>
            <div className="settings-lighting-brightness">
              {([1, 2, 3, 4, 5] as const).map((lvl) =>
                renderSettingButton(
                  String(lvl),
                  modSettings.lightingBrightness ?? 3,
                  lvl,
                  () => handleSettingChange('lightingBrightness', lvl),
                  undefined,
                  sLightingBrightness.disabled
                )
              )}
            </div>
            {renderStatusPlaceholder(sLightingBrightness.reason)}
      </Col>
      <Col span={24}>
        <div className="settings-lighting-control-heading">
          <h3 style={BASIC_SETTINGS_TITLE}>{t('settings.lighting.shadowLength')}</h3>
          <Button className="settings-lighting-reset" data-testid="shadow-length-reset"
            aria-label={`${t('settings.lighting.shadowLength')}: ${t('settings.lighting.restoreDefault')}`}
            disabled={sShadowLength.disabled||isLoading} onMouseDown={event=>event.preventDefault()}
            onClick={()=>handleSettingChange('shadowLength','default')}>{t('settings.lighting.restoreDefault')}</Button>
        </div>
        <div className="settings-lighting-angle-controls settings-shadow-length-controls">
          <Slider min={0} max={100} step={1} value={shadowLengthDraft??50}
            aria-label={t('settings.lighting.shadowLength')} disabled={sShadowLength.disabled||isLoading}
            marks={{0:t('settings.lighting.shadowShort'),100:t('settings.lighting.shadowLong')}} tooltip={{open:false}}
            onChange={setShadowLengthDraft} onChangeComplete={commitShadowLength}/>
          <InputNumber min={0} max={100} precision={0} value={modSettings.rotatingLighting?40:shadowLengthDraft} disabled={sShadowLength.disabled||isLoading}
            aria-label={t('settings.lighting.shadowLength')} placeholder={t('settings.lighting.defaultValue')}
            formatter={value=>value==null||String(value)===''?'':`${value}%`} parser={value=>Number(value?.replace('%','')||0)}
            onChange={value=>{if(typeof value==='number')setShadowLengthDraft(value);}}
            onBlur={()=>{if(shadowLengthDraft!==null)commitShadowLength(shadowLengthDraft);}}
            onPressEnter={event=>{if(event.target instanceof HTMLInputElement)event.target.blur();}}/>
        </div>
        {renderStatusPlaceholder(sShadowLength.reason)}
      </Col>
      <Col span={24}>
        <div className="settings-lighting-angle">
        <div className="settings-lighting-control-heading">
          <h3 style={BASIC_SETTINGS_TITLE}>{t('settings.lighting.angle')}</h3>
          <Button className="settings-lighting-reset" data-testid="lighting-angle-reset"
            aria-label={`${t('settings.lighting.angle')}: ${t('settings.lighting.restoreDefault')}`}
            disabled={sAngle.disabled||isLoading} onMouseDown={event=>event.preventDefault()}
            onClick={()=>handleSettingChange('lightingAngle',60)}>{t('settings.lighting.restoreDefault')}</Button>
        </div>
        <div className="settings-lighting-angle-controls">
          <Slider min={0} max={360} step={1} value={modSettings.rotatingLighting?45:lightingAngleDraft??60} disabled={sAngle.disabled || isLoading}
            aria-label={t('settings.lighting.angle')}
            tooltip={{open:false}}
            onChange={setLightingAngleDraft} onChangeComplete={commitLightingAngle} />
          <InputNumber min={0} max={360} precision={0} value={modSettings.rotatingLighting?45:lightingAngleDraft} disabled={sAngle.disabled || isLoading}
            placeholder={t('settings.lighting.defaultValue')}
            aria-label={t('settings.lighting.angle')} formatter={value => value==null||String(value)===''?'':`${value}°`}
            parser={value => Number(value?.replace('°', '') || 0)}
            onChange={value=>{if(typeof value==='number')setLightingAngleDraft(value);}}
            onBlur={()=>{if(lightingAngleDraft!==null)commitLightingAngle(lightingAngleDraft);}} onPressEnter={event=>{
              if(event.target instanceof HTMLInputElement)event.target.blur();
            }} />
        </div>
        {renderStatusPlaceholder(sAngle.reason)}
        </div>
      </Col>
    </Row></div>;
  };

  const renderBasicSettings = () => {


    return (
    <div style={{ padding: '14px', height: '100%', overflowY: 'auto' }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <h3 style={BASIC_SETTINGS_TITLE}>{t('settings.basic.resetRendering')}</h3>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <div style={BASIC_SETTINGS_DESC}>{t('settings.basic.resetRendering.desc')}</div>
            <Button
              disabled={visualSettingsDisabled}
              onClick={() => { playSmall(); handleResetRendering(); }}
              onMouseEnter={() => playHover()}
              style={{ ...BASIC_SETTINGS_CONTROL_BTN, borderColor: '#d4af37', color: '#d4af37' }}
            >
              {t('settings.basic.resetRendering')}
            </Button>
            {renderStatusPlaceholder(
              visualSettingsDisabled ? t('settings.basic.classicMode.restrict') : null,
              visualSettingsDisabled ? 'danger' : 'default'
            )}
          </Space>
        </div>

        <div>
          <h3 style={BASIC_SETTINGS_TITLE_DANGER}>{t('settings.basic.deleteMod')}</h3>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <div style={BASIC_SETTINGS_DESC}>{t('settings.basic.deleteMod.desc')}</div>
            <Button
              danger
              disabled={isClassicMode}
              onClick={() => { playSmall(); handleDeleteMod(); }}
              onMouseEnter={() => playHover()}
              style={BASIC_SETTINGS_CONTROL_BTN}
            >
              {t('settings.basic.deleteMod')}
            </Button>
            {renderStatusPlaceholder(
              isClassicMode ? t('settings.basic.classicMode.restrict') : null,
              isClassicMode ? 'danger' : 'default'
            )}
          </Space>
        </div>
      </Space>
    </div>
  );
  };

  return (
    <OverlayModal
      open={open}
      onClose={onClose}
      title={t('settings.title')}
      width="90%"
    >
      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        position: 'relative',
        height: '100%',
        overflow: 'hidden'
      }}>


        {/* 全局背景图 - 根据 hover 变化 */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: previewInfo.image ? `url("${previewInfo.image}")` : 'none',
          /* 💡 backgroundSize: 控制图片缩放 */
          backgroundSize: '70% auto',
          backgroundRepeat: 'no-repeat',
          /* 💡 backgroundPosition: 'right bottom' 让图片靠右下 */
          backgroundPosition: 'right',
          opacity: selectedCategory !== 'lighting' && previewInfo.image ? 0.7 : 0,
          transition: 'all 0.5s ease',
          zIndex: 0,
          filter: 'drop-shadow(0 0 10px rgba(0,0,0,0.5))'
        }} />

        {/* 左侧菜单 */}
        <div style={{
          width: '200px',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 0',
          zIndex: 1,
          borderRight: '1px solid rgba(212, 175, 55, 0.1)',
          overflowY: 'auto',
          flexShrink: 0
        }}>
          {categories.map(cat => (
            <div
              key={cat.id}
              onClick={() => {
                playSmall();
                setSelectedCategory(cat.id as any);
              }}
              onMouseEnter={() => playHover()}
              style={{
                padding: '15px 30px',
                cursor: 'pointer',
                background: selectedCategory === cat.id ? 'linear-gradient(90deg, rgba(212, 175, 55, 0.2), transparent)' : 'transparent',
                borderLeft: selectedCategory === cat.id ? '4px solid #d4af37' : '4px solid transparent',
                transition: 'all 0.3s',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <span style={{
                color: selectedCategory === cat.id ? '#d4af37' : '#888',
                fontSize: '18px',
                fontWeight: selectedCategory === cat.id ? 'bold' : 'normal',
                fontFamily: "'Trajan Pro 3', serif"
              }}>{cat.name}</span>
            </div>
          ))}
        </div>

        {/* 主内容区：设置 + 浮动说明 */}
        <div style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1,
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* 设置项滚动区 */}
          <div style={{ flex: 1, minHeight: 0, padding: '30px', overflowY: 'auto' }}>
            {selectedCategory === 'graphics' && renderGraphicsSettings()}
            {selectedCategory === 'game' && renderGameSettings()}
            {selectedCategory === 'lighting' && renderLightingSettings()}
            {selectedCategory === 'basic' && renderBasicSettings()}
          </div>

          {/* 底部说明区 - 悬浮设计，解决太靠下的问题 */}
          {selectedCategory !== 'lighting' && <div className="settings-preview-card" style={{
            position: 'absolute',
            bottom: '0', // 向上浮动，离开底部边缘
            left: '40px',
            right: '40px',
            padding: '20px 30px',
            background: 'linear-gradient(135deg, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.6) 100%)',
            borderRadius: '8px',
            border: '1px solid rgba(212, 175, 55, 0.2)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            opacity: previewInfo.title ? 1 : 0,
            transform: previewInfo.title ? 'translateY(0)' : 'translateY(20px)',
            transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
            pointerEvents: 'none' // 不阻碍下方滚动
          }}>
            <h4 style={{
              color: '#d4af37',
              fontSize: '18px',
              marginBottom: '8px',
              fontFamily: "'Trajan Pro 3', serif",
              textShadow: '0 2px 4px rgba(0,0,0,0.8)'
            }}>
              {previewInfo.title || '说明'}
            </h4>
            <Text style={{
              color: '#eee',
              fontSize: '14px',
              lineHeight: '1.6',
              display: 'block',
              whiteSpace: 'pre-wrap',
              textShadow: '0 1px 2px rgba(0,0,0,0.8)',
              maxWidth: '70%' // 给右侧背景图留出视觉空间
            }}>
              {previewInfo.desc}
            </Text>
          </div>}
        </div>
      </div>
    </OverlayModal>
  );
};

export default SettingsModal;
