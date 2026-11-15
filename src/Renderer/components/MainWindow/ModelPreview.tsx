import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../utils/i18n';

interface ModelPreviewProps {
  unitId?: string;
  modelPath?: string;
  fallback?: string;
  alt: string;
  scale?: number;
  className?: string;
  enabled?: boolean;
  artSet?: 'sd' | 'hd' | 'de';
  teamColor?: number;
  transparent?: boolean;
  viewDistance?: number;
  paused?: boolean;
}
function decode(value: string) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
type PreviewStatus = { key: string; params?: Record<string, string | number> };
function previewError(error: unknown): PreviewStatus {
  const detail = error instanceof Error ? error.message : String(error);
  if (/no handler registered|readModelResource is not a function/i.test(detail))
    return { key: 'skin.preview.serviceNotReady' };
  if (/chunkloaderror|loading chunk/i.test(detail))
    return { key: 'skin.preview.moduleNotReady' };
  return { key: 'skin.preview.loadError', params: { detail } };
}

export const ModelPreview: React.FC<ModelPreviewProps> = ({ unitId, modelPath, fallback, alt, scale = 1, className, enabled = true, artSet = 'hd', teamColor = 8, transparent = false, viewDistance = 1, paused = false }) => {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const suspended = useRef(paused);
  const [state, setState] = useState<PreviewStatus>({ key: 'skin.preview.loading' });
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [placeholder, setPlaceholder] = useState<'model' | 'logo' | 'none'>('model');
  const mode = artSet;
  useEffect(() => { suspended.current = paused; }, [paused]);
  useEffect(() => {
    const abort = new AbortController();
    let frame = 0, preview: Awaited<ReturnType<typeof import('../../model-preview/create-preview').createPreview>>;
    const canvas = document.createElement('canvas');
    const container = host.current;
    if (!container) return;
    const fitCanvas = () => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.round(container.clientWidth * pixelRatio);
      const height = Math.round(container.clientHeight * pixelRatio);
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      preview?.resize();
    };
    fitCanvas();
    const sizeObserver = new ResizeObserver(fitCanvas);
    sizeObserver.observe(container);
    canvas.setAttribute('aria-label', alt);
    Object.assign(canvas.style, { width: '100%', height: '100%', position: 'absolute', inset: '0', opacity: '0', cursor: 'grab' });
    container.appendChild(canvas);
    setReady(false); setState({ key: 'skin.preview.loading' });
    const read = async (path: string, basePath?: string) => {
      const resource = await window.electronAPI.readModelResource(path, basePath, mode);
      return { bytes: decode(resource.data), resolvedPath: resource.resolvedPath };
    };
    let visible = true;
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; });
    observer.observe(canvas);
    let lastX: number | undefined, dragged = false;
    canvas.onpointerdown = event => { lastX = event.clientX; dragged = false; canvas.setPointerCapture(event.pointerId); };
    canvas.onclick = event => { if (dragged) event.stopPropagation(); };
    canvas.onpointermove = event => { if (lastX !== undefined) { if (Math.abs(event.clientX - lastX) > 2) dragged = true; preview?.orbit((event.clientX - lastX) * 0.01); lastX = event.clientX; } };
    canvas.onpointerup = () => { lastX = undefined; };
    canvas.onpointercancel = () => { lastX = undefined; };
    (async () => {
      if (!enabled) { setState({ key: 'skin.preview.unavailable' }); return; }
      if (!modelPath) { setState({ key: 'skin.preview.noPath' }); return; }
      try {
        if (typeof window.electronAPI?.readModelResource !== 'function')
          throw new Error('readModelResource is not a function');
        // Cycling through skins quickly should not start a CASC read for every
        // intermediate selection. The cleanup aborts these short pending loads.
        await new Promise(resolve => window.setTimeout(resolve, 90));
        if (abort.signal.aborted) return;
        const { createPreview } = await import('../../model-preview/create-preview');
        const source = await read(modelPath);
        if (abort.signal.aborted) return;
        preview = await createPreview(canvas, source, read, { scale, signal: abort.signal, teamColor, transparent, viewDistance, unitId });
        if (abort.signal.aborted) { preview.dispose(); return; }
        preview.resize();
        canvas.style.opacity = '1'; setReady(true);
        setState(preview.missing.length ? { key: 'skin.preview.missing', params: { count: preview.missing.length } }
          : { key: Object.values(preview.omitted).some(Boolean) ? 'skin.preview.simplified' : 'skin.preview.live' });
        let previous = performance.now();
        const step = (now: number) => {
          if (abort.signal.aborted) return;
          try {
            if (!visible || document.hidden || suspended.current) previous = now;
            else if (now - previous >= 1000 / 30) {
              preview.draw(Math.min(50, now - previous));
              previous = now;
            }
          }
          catch (error) { console.warn('[ModelPreview]', error); setReady(false); setState({ key: 'skin.preview.renderError', params: { detail: error instanceof Error ? error.message : String(error) } }); canvas.style.opacity = '0'; preview.dispose(); return; }
          frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      } catch (error) {
        if (!abort.signal.aborted) { console.warn('[ModelPreview]', error); setState(previewError(error)); }
      }
    })();
    return () => { abort.abort(); cancelAnimationFrame(frame); sizeObserver.disconnect(); observer.disconnect(); preview?.dispose(); canvas.remove(); };
  }, [enabled, modelPath, mode, scale, alt, teamColor, transparent, viewDistance, unitId, retry]);
  return <div className={className} style={{ position: 'relative', width: '100%', height: '100%', background: transparent ? 'transparent' : '#090a0d', overflow: 'hidden' }}>
    {!transparent && fallback && <img src={fallback} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: ready ? 0 : 1 }} />}
    <div ref={host} style={{ position: 'absolute', inset: 0 }} />
    {ready && state.key === 'skin.preview.missing' && <span role="status" style={{ position: 'absolute', bottom: 8, left: 8, color: '#e7c35a', fontSize: 12 }}>{t(state.key, state.params)} · {t('skin.preview.checkTextures')}</span>}
    {transparent && !ready && <div role="status" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32, textAlign: 'center', color: '#dbd2bd', pointerEvents: 'none' }}>
      {placeholder !== 'none' && <img src={placeholder === 'model' ? './assets/quenching/model-preview-3d.svg' : './assets/quenching/logo.png'} alt="" onError={() => setPlaceholder(value => value === 'model' ? 'logo' : 'none')}
        style={{ width: 126, height: 126, objectFit: 'contain', opacity: .86, filter: 'drop-shadow(0 4px 20px rgba(0,0,0,.6))' }} />}
      <strong style={{ fontSize: 18, fontWeight: 400, textShadow: '0 2px 8px #000' }}>{t(state.key === 'skin.preview.loading' ? 'skin.preview.loading' : 'skin.preview.failed')}</strong>
      {state.key !== 'skin.preview.loading' && <>
        <span style={{ lineHeight: 1.5, textShadow: '0 2px 8px #000' }}>{t('skin.preview.checkModel')}</span>
        <small style={{ maxWidth: 390, color: '#a9a396', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{t(state.key, state.params)}</small>
      </>}
      {enabled && modelPath && state.key !== 'skin.preview.loading' && <button type="button" onClick={() => setRetry(value => value + 1)} style={{ pointerEvents: 'auto', padding: '5px 14px', border: '1px solid #d4af37', background: 'rgba(0,0,0,.5)', color: '#e6c45b', cursor: 'pointer' }}>{t('skin.preview.retry')}</button>}
    </div>}
    {!transparent && enabled && modelPath && <span style={{ position: 'absolute', top: 4, right: 4, color: '#ddd', fontSize: 11 }}>{artSet.toUpperCase()}</span>}
    {!transparent && <span title={t(state.key, state.params)} style={{ position: 'absolute', bottom: 3, left: 4, fontSize: 10, color: '#bbb', pointerEvents: 'none' }}>{t(state.key, state.params)}</span>}
  </div>;
};
