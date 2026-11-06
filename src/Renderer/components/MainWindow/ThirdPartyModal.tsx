import {VISION_MODULES, VisionModules} from '../../../shared/vision-modules';
import React, { useEffect, useState } from 'react';
import { Button, Checkbox, Input, Space, message } from 'antd';
import { useTranslation } from '../../utils/i18n';
import { OverlayModal } from './OverlayModal';
import { useWar3Settings } from '../../hooks/useWar3Settings';
import { useWar3Detector } from '../../hooks/useWar3Detector';
import { useSound } from '../../hooks/useSound';
import { useGlobalLoading } from '../GlobalLoadingProvider';

type ThirdPartyState = Awaited<ReturnType<typeof window.electronAPI.getThirdPartyState>>;
type TabId = 'vision' | number;

interface ThirdPartyModalProps {
  open: boolean;
  onClose: () => void;
}

const TITLE: React.CSSProperties = {
  marginTop: 0,
  marginBottom: 6,
  fontSize: '16px',
  lineHeight: 1.35,
  fontFamily: "'Trajan Pro 3', serif",
  color: '#d4af37'
};

const DESC: React.CSSProperties = {
  color: '#888',
  fontSize: '12px',
  lineHeight: 1.45,
  margin: 0
};

export const ThirdPartyModal: React.FC<ThirdPartyModalProps> = ({ open, onClose }) => {
  const { t, currentLanguage } = useTranslation();
  const { modSettings, saveModSettings, isLoading } = useWar3Settings();
  const { currentInstallation } = useWar3Detector();
  const { playSmall, playHover } = useSound();
  const { showLoading, hideLoading } = useGlobalLoading();

  const [activeTab, setActiveTab] = useState<TabId>('vision');
  const [thirdPartyState, setThirdPartyState] = useState<ThirdPartyState | null>(null);
  const [visionModules,setVisionModules]=useState<VisionModules>({});
  const [busy, setBusy] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const root = currentInstallation?.path;
  const slots = thirdPartyState?.slots || [];
  const selectedSlot = typeof activeTab === 'number' ? activeTab : null;
  const currentSlot = selectedSlot != null ? slots.find(item => item.id === selectedSlot) : null;
  const displaySlotName = (slot: { id: number; name: string }) => slot.name === `Assets ${slot.id}`
    ? t('settings.thirdParty.slotDefault', 'Assets {n}').replace(/\{n\}/g, String(slot.id))
    : slot.name;
  const displayedCurrentName = currentSlot ? displaySlotName(currentSlot) : '';
  useEffect(() => { setNameDraft(displayedCurrentName); }, [currentSlot?.id, currentSlot?.name, currentLanguage]);
  const isClassicMode = !!modSettings?.classicMode || modSettings?.graphicsSelection === 'sd';
  const visionReady = !!modSettings?.visionModPath;

  useEffect(() => {
    if (!open || !root) return;
    window.electronAPI.getVisionModules(root).then(setVisionModules).catch(error=>message.error(error.message));
    window.electronAPI.getThirdPartyState(root)
      .then(setThirdPartyState)
      .catch(error => message.error(error.message));
  }, [open, root]);

  const runThirdParty = async (action: () => Promise<ThirdPartyState>) => {
    if (!root || busy) return;
    setBusy(true);
    showLoading(t('msg.settings.updating'));
    try {
      const next = await action();
      setThirdPartyState(next);
      message.success(t('msg.settings.updated'));
    } catch (error: any) {
      message.error(error?.message || String(error));
    } finally {
      hideLoading();
      setBusy(false);
    }
  };

  const handleSettingChange = async (key: string, value: any) => {
    if (!root) {
      message.error(t('install.not_found'));
      return;
    }
    try {
      showLoading(t('msg.settings.updating'));
      await saveModSettings(root, { [key]: value });
      message.success(t('msg.settings.updated'));
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('msg.mod.failed');
      message.error(msg);
    } finally {
      hideLoading();
    }
  };

  const handleSelectVisionModPath = async () => {
    playSmall();
    const path = await window.electronAPI?.selectDirectory(t('setup.visionmod.path'));
    if (!path) return;
    const valid_1 = await window.electronAPI?.pathExists(`${path}/Install Guide.txt`);
    const valid_2 = await window.electronAPI?.pathExists(`${path}/visionmod.txt.txt`);
    const valid_3 = await window.electronAPI?.pathExists(`${path}/visionmod.txt`);
    if (valid_1 || valid_2 || valid_3) {
      await handleSettingChange('visionModPath', path);
      message.success(t('msg.visionmod.path.set'));
    } else {
      message.error(t('msg.visionmod.path.invalid'));
    }
  };

  const toggleBtn = (
    label: string,
    selected: boolean,
    onClick: () => void,
    disabled?: boolean
  ) => (
    <Button
      disabled={isLoading || busy || disabled}
      onClick={(e) => {
        e.currentTarget.blur();
        playSmall();
        onClick();
      }}
      onMouseEnter={() => playHover()}
      style={{
        background: selected ? 'rgba(212, 175, 55, 0.3)' : 'rgba(0,0,0,0.5)',
        border: selected ? '1px solid #d4af37' : '1px solid rgba(212, 175, 55, 0.3)',
        color: selected ? '#fff' : '#aaa',
        fontSize: '12px',
        height: '28px',
        minWidth: '80px',
        opacity: isLoading || busy || disabled ? 0.4 : 1
      }}
    >
      {label}
    </Button>
  );

  const statusHint = (reason?: string) => (
    <div style={{ color: '#666', fontSize: '12px', marginTop: 8, minHeight: 18 }}>
      {reason || '\u00A0'}
    </div>
  );

  const visionDisabledReason = isClassicMode
    ? t('settings.basic.classicMode.disabled')
    : !visionReady
      ? t('settings.status.visionmod_required')
      : undefined;

  const renderVisionTab = () => (
    <div style={{ maxWidth: 720 }}>
      <h3 style={TITLE}>{t('settings.thirdParty.vision', 'VisionMod')}</h3>
      <p style={{ ...DESC, marginBottom: 16 }}>
        {t('setup.visionmod.path')}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <div style={{
          flex: 1,
          padding: '10px 14px',
          background: 'rgba(0, 0, 0, 0.35)',
          border: '1px solid rgba(212, 175, 55, 0.25)',
          borderRadius: 4,
          color: '#aaa',
          fontSize: 13,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {modSettings.visionModPath || t('setup.visionmod.unset')}
        </div>
        <Button
          type="primary"
          ghost
          onClick={handleSelectVisionModPath}
          onMouseEnter={() => playHover()}
          style={{ borderColor: '#d4af37', color: '#d4af37' }}
        >
          {t('setup.btn.change')}
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
        {VISION_MODULES.map(key=><div key={key}>
          <h3 style={TITLE}>{t(`settings.vision.${key}.title`)}</h3>
          <p style={DESC}>{t(`settings.vision.${key}.desc`)}</p>
          <Checkbox aria-label={t(`settings.vision.${key}.title`)} checked={!!visionModules[key]} disabled={busy||isLoading||(!visionModules[key]&&!!visionDisabledReason)}
            onChange={async event=>{const enabled=event.target.checked;setBusy(true);try{await handleSettingChange(key,enabled);setVisionModules(await window.electronAPI.getVisionModules(root!));}catch(error:any){message.error(error?.message||String(error));}finally{setBusy(false);}}}>
            {t(visionModules[key]?'settings.btn.turnon':'settings.btn.turnoff')}
          </Checkbox>
          {statusHint(visionDisabledReason)}
        </div>)}
      </div>
    </div>
  );

  const importZip = async () => {
    if (!root || selectedSlot == null) return;
    const zip = await window.electronAPI.selectFile({
      title: t('settings.thirdParty.importZip', '从 ZIP 导入'),
      filters: [{ name: 'ZIP', extensions: ['zip'] }]
    });
    if (zip) await runThirdParty(() => window.electronAPI.importThirdPartyZip(root, selectedSlot, zip));
  };

  const importDirectory = async () => {
    if (!root || selectedSlot == null) return;
    const directory = await window.electronAPI.selectDirectory(t('settings.thirdParty.importDirectory', '从目录导入'));
    if (directory) await runThirdParty(() => window.electronAPI.importThirdPartyDirectory(root, selectedSlot, directory));
  };

  const renderSlotTab = () => {
    if (!root || !currentSlot || !thirdPartyState || selectedSlot == null) {
      return (
        <div style={{ maxWidth: 720 }}>
          <h3 style={TITLE}>{t('settings.thirdParty.resources', '第三方资源')}</h3>
          <p style={DESC}>{t('settings.thirdParty.desc')}</p>
        </div>
      );
    }

    const imported = currentSlot.imported;
    const features = currentSlot.features || [];

    return (
      <div style={{ maxWidth: 720 }}>
        <h3 style={TITLE}>{displayedCurrentName}</h3>
        <Input
          aria-label={t('settings.thirdParty.rename', '资源槽名称')}
          value={nameDraft}
          maxLength={40}
          disabled={busy}
          onChange={event => setNameDraft(event.target.value)}
          onPressEnter={event => event.currentTarget.blur()}
          onBlur={() => {
            const name = nameDraft.trim();
            if (name && name !== displayedCurrentName && name !== currentSlot.name) {
              void runThirdParty(() => window.electronAPI.setThirdPartyName(root, selectedSlot, name));
            }
          }}
          style={{ maxWidth: 300, marginBottom: 12 }}
        />
        <p style={DESC}>{t('settings.thirdParty.desc')}</p>
        <Space style={{ marginTop: 16 }} wrap>
          <Button disabled={busy} onClick={() => void importZip()}>{t('settings.thirdParty.importZip', '从 ZIP 导入')}</Button>
          <Button disabled={busy} onClick={() => void importDirectory()}>{t('settings.thirdParty.importDirectory', '从目录导入')}</Button>
        </Space>
        {!imported ? (
          <p style={{ ...DESC, marginTop: 18 }}>{t('settings.thirdParty.needImport', '还没有导入资源。导入之前不能开启，也不会改动游戏目录。')}</p>
        ) : (
          <>
            <p style={{ ...DESC, marginTop: 18 }}>
              {t('settings.thirdParty.staged', '已暂存，尚未生效：')} {currentSlot.stagingPath}
            </p>
            {!!currentSlot.topLevel?.length && (
              <p style={{ ...DESC, color: '#d4af37' }}>
                {t('settings.thirdParty.topLevel', '将放入游戏分支的一级目录：')} {currentSlot.topLevel.join(', ')}
              </p>
            )}
            <div style={{ marginTop: 18 }}>
              <h3 style={TITLE}>{t('settings.thirdParty.enable', '使用这份资源')}</h3>
              <Space>
                {toggleBtn(t('settings.btn.turnon'), currentSlot.enabled, () => runThirdParty(() => window.electronAPI.setThirdPartyEnabled(root, selectedSlot, true)), currentSlot.enabled)}
                {toggleBtn(t('settings.btn.turnoff'), !currentSlot.enabled, () => runThirdParty(() => window.electronAPI.setThirdPartyEnabled(root, selectedSlot, false)), !currentSlot.enabled)}
              </Space>
            </div>
            <div style={{ marginTop: 22 }}>
              <h3 style={TITLE}>{t('settings.thirdParty.keep', '同时保留的淬火功能')}</h3>
              <p style={DESC}>{t('settings.thirdParty.keepDesc', '和资源包冲突的项目不能打开。资源包内容不变时，这些项目会保持关闭。')}</p>
              <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
                {features.map(feature => {
                  const title = t(`settings.thirdParty.feature.${feature.id}`, feature.id);
                  const detail = t(`settings.thirdParty.feature.${feature.id}.detail`, '');
                  return (
                    <label key={feature.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', opacity: feature.blocked ? 0.55 : 1 }}>
                      <Checkbox
                        checked={feature.selected}
                        disabled={busy || feature.blocked}
                        onChange={event => runThirdParty(() => window.electronAPI.setThirdPartyFeature(root, selectedSlot, feature.id, event.target.checked))}
                      />
                      <span>
                        <strong style={{ color: '#e6d7a2', fontWeight: 600 }}>{title}</strong>
                        <span style={{ ...DESC, display: 'block' }}>{feature.blocked ? t('settings.thirdParty.conflict', '与资源包冲突，在资源包变化前不能打开') : detail}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <OverlayModal open={open} onClose={onClose} title={t('main.btn.thirdParty', '第三方支持')} width="90%">
      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        position: 'relative',
        height: '100%',
        overflow: 'hidden'
      }}>
        <div style={{
          width: 220,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 0',
          zIndex: 1,
          borderRight: '1px solid rgba(212, 175, 55, 0.1)',
          overflowY: 'auto',
          flexShrink: 0
        }}>
          <div
            onClick={() => {
              playSmall();
              setActiveTab('vision');
            }}
            onMouseEnter={() => playHover()}
            style={{
              padding: '15px 24px',
              cursor: 'pointer',
              background: activeTab === 'vision' ? 'linear-gradient(90deg, rgba(212, 175, 55, 0.2), transparent)' : 'transparent',
              borderLeft: activeTab === 'vision' ? '4px solid #d4af37' : '4px solid transparent',
              transition: 'all 0.3s'
            }}
          >
            <span style={{
              color: activeTab === 'vision' ? '#d4af37' : '#888',
              fontSize: 16,
              fontWeight: activeTab === 'vision' ? 'bold' : 'normal',
              fontFamily: "'Trajan Pro 3', serif"
            }}>
              {t('settings.thirdParty.vision', 'VisionMod')}
            </span>
          </div>

          {slots.map(item => {
            const selected = activeTab === item.id;
            const active = thirdPartyState?.activeSlotId === item.id;
            return (
              <div
                key={item.id}
                onClick={() => {
                  playSmall();
                  setActiveTab(item.id);
                }}
                onMouseEnter={() => playHover()}
                style={{
                  padding: '15px 24px',
                  cursor: 'pointer',
                  background: selected ? 'linear-gradient(90deg, rgba(212, 175, 55, 0.2), transparent)' : 'transparent',
                  borderLeft: selected ? '4px solid #d4af37' : '4px solid transparent',
                  transition: 'all 0.3s'
                }}
              >
                <div style={{
                  color: selected ? '#d4af37' : '#888',
                  fontSize: 16,
                  fontWeight: selected ? 'bold' : 'normal',
                  fontFamily: "'Trajan Pro 3', serif"
                }}>
                  {displaySlotName(item)}
                </div>
                {active && (
                  <div style={{ color: 'rgba(212,175,55,0.75)', fontSize: 11, marginTop: 4 }}>
                    {t('settings.thirdParty.active', '当前使用中')}
                  </div>
                )}
              </div>
            );
          })}

        </div>

        <div style={{
          flex: 1,
          minHeight: 0,
          padding: 30,
          overflowY: 'auto',
          zIndex: 1
        }}>
          {activeTab === 'vision' ? renderVisionTab() : renderSlotTab()}
        </div>
      </div>
    </OverlayModal>
  );
};

export default ThirdPartyModal;
