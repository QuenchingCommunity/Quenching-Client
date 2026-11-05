import React, { useEffect, useRef, useState } from 'react';
import { Switch, message, Modal } from 'antd';
import { ModelPreview } from './ModelPreview';
import { CustomSkinEditor } from './CustomSkinEditor';
import { OverlayModal } from './OverlayModal';
import { SKIN_CONFIG } from '../../assets/data/skin-config';
import { builtInSkins, PanelSkin, skinTargets, warbandChoices } from '../../assets/data/skin-panel-catalog';
import { SkinSelections, VersionSkinChange, VersionSkinChoice, scopedSkin } from '../../../shared/skin-versions';
import { activeSkinArtSet } from '../../../shared/active-skin-art-set';
import { useWar3Detector } from '../../hooks/useWar3Detector';
import { useWar3Settings } from '../../hooks/useWar3Settings';
import { useSound } from '../../hooks/useSound';
import * as styles from './SkinModal.module.less';
import { useTranslation } from '../../utils/i18n';
import { builtInSkinLabel, targetLabel } from '../../utils/skin-labels';

interface SkinModalProps { open: boolean; onClose: () => void; isFullPackageInstalled?: boolean }
type Category = 'hero' | 'unit' | 'building';
type UnitMode = 'single' | 'warband' | 'retro';
const races = [
  { id: 'hum', icon: 'human-icon-pressed.png', glow: 'rgba(75,142,255,.85)', teamColor: 1 },
  { id: 'orc', icon: 'orc-icon-pressed.png', glow: 'rgba(255,70,62,.85)', teamColor: 0 },
  { id: 'ud', icon: 'undead-icon-pressed.png', glow: 'rgba(175,94,255,.9)', teamColor: 3 },
  { id: 'ne', icon: 'nightelf-icon-pressed.png', glow: 'rgba(64,217,213,.85)', teamColor: 2 },
  { id: 'neutral', icon: 'random-icon-.png', glow: 'rgba(178,183,190,.72)', teamColor: 8 },
] as const;
const categories: { id: Category; icon: string }[] = [
  { id: 'hero', icon: 'skin-nav-hero.png' },
  { id: 'unit', icon: 'skin-nav-unit.png' },
  { id: 'building', icon: 'skin-nav-building.png' },
];
const asset = (name?: string) => `./assets/quenching/${name || 'logo.png'}`;
const needsPackage = (config: VersionSkinChange[]) => config.some(change => /^file(?::|$)/.test(change.field) && /^cos[\\/](?!custom[\\/])/i.test(change.value));
const modelFrom = (original: VersionSkinChange[], changes: VersionSkinChange[], artSet: 'sd' | 'hd' | 'de') =>
  scopedSkin([...original, ...changes], artSet).find(change => change.field === `file:${artSet}`)?.value;

export const SkinModal: React.FC<SkinModalProps> = ({ open, onClose, isFullPackageInstalled = false }) => {
  const { t } = useTranslation();
  const { currentInstallation } = useWar3Detector();
  const { modSettings, settings } = useWar3Settings();
  const { playSmall, playHover } = useSound();
  const artSet = activeSkinArtSet(modSettings.graphicsSelection, settings.hd, modSettings.classicMode, settings.detectedGraphics);
  const [raceId, setRaceId] = useState('hum');
  const [category, setCategory] = useState<Category>('hero');
  const [unitMode, setUnitMode] = useState<UnitMode>('single');
  const [targetId, setTargetId] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [presetId, setPresetId] = useState('');
  const [custom, setCustom] = useState<CustomSkinRecord[]>([]);
  const [selections, setSelections] = useState<SkinSelections>({});
  const [originals, setOriginals] = useState<Record<string, VersionSkinChange[]>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const applying = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [retro, setRetro] = useState({ unitsEnabled: false, buildingsEnabled: false, unitsDirName: null as string | null, buildingsDirName: null as string | null });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setError(''); setOriginals({});
    Promise.all([window.electronAPI.getVersionSkinPanel(artSet), window.electronAPI.listCustomSkins(), window.electronAPI.isSkinEnabled(), window.electronAPI.getRetroSkinStatus()])
      .then(([panel, saved, active, status]) => {
        if (cancelled) return;
        setSelections(panel.selections); setOriginals(panel.originals); setCustom(saved); setEnabled(active); setRetro(status);
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message || t('skin.panel.readFailed')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, artSet, currentInstallation?.path]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy && !editorOpen) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, editorOpen, onClose]);

  const race = races.find(item => item.id === raceId)!;
  const visibleRaces = category === 'hero' ? races : races.filter(item => item.id !== 'neutral');
  const isWarband = category === 'unit' && unitMode === 'warband';
  const isRetro = category === 'unit' && unitMode === 'retro';
  const targets = skinTargets(raceId, category).map(item => ({ ...item, name: targetLabel(item.unitId, category, item.name, t) }));
  const target = targets.find(item => item.unitId === targetId) || targets[0];
  const skins: PanelSkin[] = target ? [
    { id: 'original', name: t('skin.panel.original'), config: [] },
    ...builtInSkins(raceId, target.unitId, artSet).map(item => ({ ...item, name: builtInSkinLabel(item.id, raceId, target.unitId, item.name, t) })),
    ...custom.filter(item => (item.artSet || 'hd') === artSet && item.targetId === target.unitId && item.category === category),
  ] : [];
  const currentSkin = skins.find(item => item.id === previewId)
    || skins.find(item => item.id === selections[artSet]?.[target?.unitId]) || skins[0];
  const warbands = artSet === 'hd' ? (SKIN_CONFIG[raceId]?.warbands || []).map(item => ({ ...item, name: builtInSkinLabel(item.id, raceId, '', item.name, t) })) : [];
  const currentPreset = warbands.find(item => item.id === presetId)
    || warbands.find(item => {
      const choices = warbandChoices(raceId, item.id);
      return choices.length > 0 && choices.every(choice => (selections[artSet]?.[choice.unitId] || 'original') === choice.skinId);
    }) || warbands[0];
  const presetChoices = currentPreset ? warbandChoices(raceId, currentPreset.id) : [];
  const presetComplete = presetChoices.length > 0 && presetChoices.every(item => (selections[artSet]?.[item.unitId] || 'original') === item.skinId);
  const representative = presetChoices.find(item => item.changes.some(c => c.field === 'file' || c.field.startsWith('file:'))) || presetChoices[0];
  const previewModel = !isWarband && target && currentSkin
    ? modelFrom(originals[target.unitId] || [], currentSkin.config, artSet) : undefined;
  const previewTitle = isWarband ? currentPreset?.name : currentSkin?.name;
  const canApply = !busy && !loading && !error && !!originals[isWarband ? representative?.unitId : target?.unitId];
  const unavailable = isWarband ? !!currentPreset && !isFullPackageInstalled && needsPackage(currentPreset.config)
    : !!currentSkin && !isFullPackageInstalled && needsPackage(currentSkin.config);

  const apply = async (choices: VersionSkinChoice[]) => {
    if (applying.current) return false;
    applying.current = true;
    setBusy(true);
    try {
      setSelections(await window.electronAPI.applyVersionSkins(artSet, choices));
      setEnabled(true);
      return true;
    } catch (e: any) { message.error(e.message || t('skin.apply.fail')); }
    finally { applying.current = false; setBusy(false); }
    return false;
  };
  const toggle = async () => {
    setBusy(true);
    try {
      if (enabled) await window.electronAPI.disableSkins(); else await window.electronAPI.enableSkins();
      setEnabled(!enabled);
    } catch (e: any) { message.error(e.message || t('skin.panel.toggleFailed')); }
    finally { setBusy(false); }
  };
  const deleteCurrentSkin = () => {
    if (!currentSkin || !custom.some(item => item.id === currentSkin.id)) return;
    const id = currentSkin.id;
    Modal.confirm({
      title: t('skin.panel.deleteTitle', { name: currentSkin.name }),
      content: t('skin.panel.deleteDescription'),
      okText: t('skin.panel.delete'), cancelText: t('btn.cancel'), okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(true);
        try {
          await window.electronAPI.deleteCustomSkin(id);
          const panel = await window.electronAPI.getVersionSkinPanel(artSet);
          setSelections(panel.selections); setOriginals(panel.originals);
          setCustom(previous => previous.filter(item => item.id !== id));
          setPreviewId('original');
          message.success(t('skin.panel.deleted'));
        } catch (e: any) { message.error(e.message || t('skin.panel.deleteFailed')); throw e; }
        finally { setBusy(false); }
      },
    });
  };
  const toggleRetro = async (field: 'unitsEnabled' | 'buildingsEnabled', value: boolean) => {
    setBusy(true);
    try { setRetro(await window.electronAPI.applyRetroSkin({ [field]: value })); }
    catch (e: any) { message.error(e.message || t('skin.panel.retroFailed')); }
    finally { setBusy(false); }
  };
  const chooseRace = (id: string) => { playSmall(); setRaceId(id); setTargetId(''); setPreviewId(''); setPresetId(''); setEditorOpen(false); };
  const chooseCategory = (id: Category) => { playSmall(); setCategory(id); if (id !== 'hero' && raceId === 'neutral') setRaceId('hum'); setUnitMode('single'); setTargetId(''); setPreviewId(''); setPresetId(''); setEditorOpen(false); };
  const cycleSkin = async (step: number) => {
    if (!canApply || !target || !skins.length || applying.current) return;
    const index = skins.findIndex(item => item.id === currentSkin?.id);
    const next = (index + step + skins.length) % skins.length;
    const skin = skins[next];
    setPreviewId(skin.id);
    if (!isFullPackageInstalled && needsPackage(skin.config)) { message.info(t('skin.panel.needPackage')); return; }
    playSmall();
    await apply([{ unitId: target.unitId, skinId: skin.id, changes: skin.config }]);
  };
  const cyclePreset = async (step: number) => {
    if (!canApply || !warbands.length || applying.current) return;
    const index = warbands.findIndex(item => item.id === currentPreset?.id);
    const preset = warbands[(index + step + warbands.length) % warbands.length];
    setPresetId(preset.id);
    if (!isFullPackageInstalled && needsPackage(preset.config)) { message.info(t('skin.panel.needPackage')); return; }
    playSmall();
    const choices = warbandChoices(raceId, preset.id);
    if (choices.length) await apply(choices);
  };

  if (!open) return null;
  return <>
    <OverlayModal open={open} onClose={busy ? () => undefined : onClose} title={t('skin.title')} width="90%">
      <div className={styles.layout}>
        <nav className={styles.sidebar} aria-label={t('skin.panel.categories')}>
          {categories.map(item => <button key={item.id} className={`${styles.category} ${category === item.id ? styles.categoryActive : ''}`}
            disabled={busy} aria-pressed={category === item.id} onClick={() => chooseCategory(item.id)} onMouseEnter={playHover}>
            <img src={asset(item.icon)} alt="" /><span>{t(`skin.category.${item.id}`)}</span>
          </button>)}
          <div className={styles.sidebarFoot}>{t('skin.panel.quality', { mode: artSet.toUpperCase() })}<br /><small>{t('skin.panel.switchQuality')}</small></div>
        </nav>
        <div className={styles.content}>
          <main className={styles.controls}>
            <div className={styles.intro}>
              <span>{t(`skin.race.${race.id}`)} · {artSet.toUpperCase()}</span>
              <h2>{t(`skin.panel.title.${category}`)}</h2>
              <p>{t(isWarband ? 'skin.panel.introWarband' : category === 'unit' ? 'skin.panel.introUnit' : 'skin.panel.introModel')}</p>
            </div>
            <div className={`${styles.activationBar} ${enabled ? '' : styles.activationOff}`}>
              <div className={styles.activationStatus}>
                <strong>{t(enabled ? 'skin.panel.enabled' : 'skin.panel.disabled')}</strong>
                <small>{t(enabled ? 'skin.panel.enabledHint' : 'skin.panel.disabledHint')}</small>
              </div>
              <button className={`${styles.activationButton} ${!enabled ? styles.activationPrimary : ''}`}
                onClick={toggle} disabled={busy || loading}>
                {t(busy ? 'skin.panel.processing' : enabled ? 'skin.disable' : 'skin.allow')}
              </button>
            </div>
            {category === 'unit' && <div className={styles.unitModes} role="group" aria-label={t('skin.panel.unitModes')}>
              {(['single', 'warband', 'retro'] as const).map(id =>
                <button key={id} className={unitMode === id ? styles.modeActive : ''} aria-pressed={unitMode === id}
                  disabled={busy} onClick={() => { playSmall(); setUnitMode(id); setEditorOpen(false); }} onMouseEnter={playHover}>{t(`skin.panel.mode.${id}`)}</button>)}
            </div>}
            {!isRetro && <section>
              <h3>{t('skin.panel.race')}</h3>
              <div className={styles.races} role="group" aria-label={t('skin.panel.selectRace')}>
                {visibleRaces.map(item => <button key={item.id} className={`${styles.race} ${raceId === item.id ? styles.raceActive : ''}`}
                  disabled={busy} title={t(`skin.race.${item.id}`)} aria-label={t(`skin.race.${item.id}`)} aria-pressed={raceId === item.id} onClick={() => chooseRace(item.id)} onMouseEnter={playHover}>
                  <img src={asset(item.icon)} alt="" />
                </button>)}
              </div>
            </section>}
            {error && <div role="alert" className={styles.notice}>{error}</div>}
            {isRetro ? <section className={styles.retroBox}>
              <h3>{t('skin.panel.mode.retro')}</h3>
              {(['unitsEnabled', 'buildingsEnabled'] as const).map(field => <div className={styles.retroRow} key={field}>
                <span>{t(field === 'unitsEnabled' ? 'skin.panel.retroUnits' : 'skin.panel.retroBuildings')}<small>{field === 'unitsEnabled' ? retro.unitsDirName : retro.buildingsDirName}</small></span>
                <Switch checked={retro[field]} disabled={busy || artSet !== 'hd' || !isFullPackageInstalled} onChange={checked => void toggleRetro(field, checked)} />
              </div>)}
              {artSet !== 'hd' && <p>{t('skin.panel.retroHD')}</p>}
              {!isFullPackageInstalled && <p>{t('skin.panel.needPackage')}</p>}
            </section> : <>
              {!isWarband && <section className={styles.targetSection}>
                <h3>{t(`skin.panel.select.${category}`)}</h3>
                <div className={styles.targets}>
                  {targets.map(item => <button key={item.unitId} className={`${styles.target} ${target?.unitId === item.unitId ? styles.targetActive : ''}`}
                    disabled={busy} title={item.name} aria-label={item.name} aria-pressed={target?.unitId === item.unitId}
                    onClick={() => { playSmall(); setTargetId(item.unitId); setPreviewId(''); setEditorOpen(false); }} onMouseEnter={playHover}>
                    {item.icon ? <img src={asset(item.icon)} alt="" /> : <span className={styles.targetLabel}>{item.name}</span>}
                  </button>)}
                </div>
                {!targets.length && <p className={styles.empty}>{t('skin.panel.noTargets')}</p>}
              </section>}
              <section className={styles.choiceSection}>
                <h3>{t('skin.panel.skins')}</h3>
                {isWarband && !warbands.length && <p className={styles.empty}>{t('skin.panel.noWarbands')}</p>}
                <div className={styles.choiceRow}>
                  <button className={styles.arrow} aria-label={t(isWarband ? 'skin.panel.previousWarband' : 'skin.panel.previousSkin')} onClick={() => void (isWarband ? cyclePreset(-1) : cycleSkin(-1))} disabled={!canApply || (isWarband ? !warbands.length : !skins.length)}>‹</button>
                  <div className={styles.choiceName}><strong>{previewTitle || t(isWarband ? 'skin.panel.noWarbands' : 'skin.panel.noSkins')}</strong><small>{isWarband ? currentPreset ? t('skin.panel.targetCount', { count: presetChoices.length }) : t('skin.panel.noWarbands') : t(currentSkin && selections[artSet]?.[target?.unitId] === currentSkin.id ? 'skin.panel.currentApplied' : 'skin.panel.livePreview')}</small></div>
                  <button className={styles.arrow} aria-label={t(isWarband ? 'skin.panel.nextWarband' : 'skin.panel.nextSkin')} onClick={() => void (isWarband ? cyclePreset(1) : cycleSkin(1))} disabled={!canApply || (isWarband ? !warbands.length : !skins.length)}>›</button>
                  <span className={styles.selectionStatus} role="status">{t(busy ? 'skin.panel.processing' : unavailable ? 'skin.panel.needPackage' :
                    (isWarband ? presetComplete : (selections[artSet]?.[target?.unitId] || 'original') === currentSkin?.id)
                      ? 'skin.panel.currentApplied' : 'skin.panel.livePreview')}</span>
                </div>
                {!isWarband && <div className={styles.choiceMeta}>
                  <span className={styles.skinCount}>{target ? `${Math.max(0, skins.findIndex(item => item.id === currentSkin?.id) + 1)} / ${skins.length} · ${target.name}` : ''}</span>
                  {target && <button className={styles.addCustom} disabled={busy || loading} onClick={() => { playSmall(); setEditorOpen(true); }}>
                    <span aria-hidden="true">＋</span> {t('skin.editor.title')}
                  </button>}
                  {custom.some(item => item.id === currentSkin?.id) && <button className={styles.addCustom}
                    disabled={busy || loading} onClick={deleteCurrentSkin}>{t('skin.panel.deleteCustom')}</button>}
                </div>}
              </section>
            </>}
            <div className={styles.secondaryActions}>
              <button className={styles.toggle} onClick={() => message.info(t(isWarband ? 'skin.panel.helpWarband' : 'skin.panel.helpModel'))}>{t('skin.panel.help')}</button>
            </div>
          </main>
          <aside className={styles.showcase} style={{ '--team-glow': race.glow } as React.CSSProperties} aria-label={t(isWarband ? 'skin.panel.warbandPreview' : 'skin.panel.modelPreview')}>
            <div className={styles.halo} />
            {isWarband ? <div className={styles.warbandPreview}>
              {currentPreset ? <img key={currentPreset.id} src={asset(currentPreset.preview)} alt={t('skin.panel.warbandAlt', { name: currentPreset.name })} />
                : <span>{t('skin.panel.noWarbands')}</span>}
            </div> : !isRetro ? <div className={styles.model}>
              <ModelPreview key={`${artSet}:${raceId}:${category}:${unitMode}:${target?.unitId || currentPreset?.id}:${previewTitle}`}
                modelPath={previewModel} unitId={target?.unitId} artSet={artSet} teamColor={race.teamColor}
                alt={previewTitle || t('skin.select.prompt')} enabled={!loading && !unavailable} paused={editorOpen}
                transparent viewDistance={category === 'building' ? 1.25 : 1} />
            </div> : <div className={styles.retroPreview}>{t('skin.panel.retroPreview')}</div>}
            {!isRetro && (!isWarband || currentPreset) && <div className={styles.showcaseHint}>{isWarband ? `${currentPreset?.name} · ${t('skin.panel.targetCount', { count: presetChoices.length })}` : t('skin.panel.rotateHint')}</div>}
          </aside>
        </div>
      </div>
    </OverlayModal>
    {target && editorOpen && <CustomSkinEditor open={editorOpen} artSet={artSet} targetId={target.unitId} targetName={target.name}
      category={category} race={raceId} onClose={() => setEditorOpen(false)}
      onCreated={item => { setCustom(previous => [...previous, item]); setPreviewId(item.id); void apply([{ unitId: item.targetId, skinId: item.id, changes: item.config }]); }} />}
  </>;
};
