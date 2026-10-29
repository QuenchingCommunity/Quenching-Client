import React, { useRef, useEffect, useState } from 'react';
import styles from './BackgroundVideo.module.less';
import { resolveThemeMedia, reportThemeMediaError } from '../../utils/theme-media';

// 检查 styles 是否存在，避免 undefined 错误
const safeStyles = styles || {
  backgroundVideo: 'background-video',
  video: 'video',
  overlay: 'overlay'
};

interface BackgroundVideoProps {
  volume?: number;
  opacity?: number;
  paused?: boolean;
}

export const BackgroundVideo: React.FC<BackgroundVideoProps> = ({
  volume = 0,
  opacity = 0.65,
  paused = false
}) => {
  const resolveAssetPath = (source: string) => resolveThemeMedia(source, document.baseURI);
  const failedSources = useRef(new Set<string>());
  const [videoSources, setVideoSources] = useState({
    active: '',
    next: ''
  });
  const [fadeState, setFadeState] = useState<'idle' | 'fading'>('idle');
  const latestSources = useRef(videoSources);
  latestSources.current = videoSources;
  const sourceRequest = useRef(0);

  const videoRef1 = useRef<HTMLVideoElement>(null);
  const videoRef2 = useRef<HTMLVideoElement>(null);
  const [activeVideo, setActiveVideo] = useState<1 | 2>(1);

  // 视频源映射
  const themeVideos: Record<string, string> = {
    'magicstorm': 'assets/quenching/magicstorm.mp4',
    'roc': 'assets/quenching/mainmenu1.mp4', // 混乱之治
    'tft': 'assets/quenching/mainmenu0.mp4', // 冰封王座
    'quenching': 'assets/quenching/mainmenu2.mp4',
    'warcraft2': 'assets/quenching/mainmenu3.mp4',
    'city': 'assets/quenching/mainmenu4.mp4',
    'plaguelands': 'assets/quenching/mainmenu5.mp4'
  };

  // 初始化加载
  useEffect(() => {
    let cancelled = false;
    const request = ++sourceRequest.current;
    const loadTheme = async () => {
      console.log('[BackgroundVideo] Starting to load theme...');
      try {
        let themeId = 'magicstorm';
        if (window.electronAPI?.getConfig) {
          const savedTheme = await window.electronAPI.getConfig('theme');
          if (savedTheme) themeId = savedTheme;
        }

        console.log('[BackgroundVideo] Current theme ID:', themeId);

        let initialSrc = '';
        if (themeId.startsWith('custom-')) {
          const customThemes = await window.electronAPI?.getConfig('customThemes');
          const theme = customThemes?.find((t: any) => t.id === themeId);
          initialSrc = theme?.videoPath || themeVideos['magicstorm'];
        } else {
          initialSrc = themeVideos[themeId] || themeVideos['magicstorm'];
        }

        console.log('[BackgroundVideo] Setting initial video source:', initialSrc);
        if (cancelled || request !== sourceRequest.current) return;
        setVideoSources({ active: resolveAssetPath(initialSrc), next: '' });
      } catch (error) {
        if (cancelled || request !== sourceRequest.current) return;
        console.error('[BackgroundVideo] Failed to load theme, falling back to magicstorm:', error);
        setVideoSources({ active: resolveAssetPath(themeVideos['magicstorm']), next: '' });
      }
    };

    loadTheme();
    return () => {cancelled=true;};
  }, []);

  // 只给当前视频设置资源；播放由可见性统一控制。
  useEffect(() => {
    const activeRef = activeVideo === 1 ? videoRef1 : videoRef2;
    if (activeRef.current && videoSources.active) {
      if (activeRef.current.src !== videoSources.active) {
        activeRef.current.src = videoSources.active;
        activeRef.current.load();
      }
    }
  }, [videoSources.active, activeVideo]);

  // 遮罩弹窗和窗口不可见时，后台视频不再持续解码、与 3D 预览争抢 GPU。
  useEffect(() => {
    const syncPlayback = () => {
      const first = videoRef1.current, second = videoRef2.current;
      if (paused || document.hidden) {
        first?.pause(); second?.pause();
        return;
      }
      if (fadeState !== 'fading') {
        const active = activeVideo === 1 ? first : second;
        const inactive = activeVideo === 1 ? second : first;
        inactive?.pause();
        if (active?.src) active.play().catch(error => console.warn('[BackgroundVideo] Playback failed:', error));
      }
    };
    syncPlayback();
    document.addEventListener('visibilitychange', syncPlayback);
    return () => document.removeEventListener('visibilitychange', syncPlayback);
  }, [paused, activeVideo, fadeState, videoSources.active]);

  // 监听主题变化
  useEffect(() => {
    const handleThemeChange = async (e: any) => {
      if (e.detail) {
        const request=++sourceRequest.current;
        const newThemeId = e.detail;
        let newSrc = '';

        if (newThemeId.startsWith('custom-')) {
          const customThemes = await window.electronAPI?.getConfig('customThemes');
          const theme = customThemes?.find((t: any) => t.id === newThemeId);
          newSrc = theme?.videoPath || themeVideos['magicstorm'];
        } else {
          newSrc = themeVideos[newThemeId] || themeVideos['magicstorm'];
        }

        if(request!==sourceRequest.current)return;
        const resolved=resolveAssetPath(newSrc),previous=latestSources.current;
        if(resolved===previous.next)return;
        if(resolved===previous.active){
          if(previous.next){setVideoSources({...previous,next:''});setFadeState('idle');}
          return;
        }
        setFadeState('fading');setVideoSources({...previous,next:resolved});
      }
    };

    window.addEventListener('theme-changed', handleThemeChange);
    return () => window.removeEventListener('theme-changed', handleThemeChange);
  }, []);

  // 处理渐变逻辑
  useEffect(() => {
    if (!paused && fadeState === 'fading' && videoSources.next) {
      const nextVideo = activeVideo === 1 ? videoRef2.current : videoRef1.current;
      const currentVideo = activeVideo === 1 ? videoRef1.current : videoRef2.current;

      if (nextVideo && currentVideo) {
        let cancelled = false;
        const onCanPlay = () => {
          nextVideo.play().then(() => {
            if (cancelled) return;
            // 切换激活视频
            currentVideo.pause();
            setActiveVideo(activeVideo === 1 ? 2 : 1);
            setVideoSources({ active: videoSources.next, next: '' });
          }).catch(error => {
            if (!cancelled && error.name !== 'AbortError') {
              console.warn('[BackgroundVideo] Theme switch playback failed:', error);
              setVideoSources(previous => ({...previous,next:''}));setFadeState('idle');
            }
          });
        };
        const onError = () => {
          reportThemeMediaError(nextVideo);
          setVideoSources(previous => ({...previous,next:''}));setFadeState('idle');
        };
        nextVideo.addEventListener('canplay', onCanPlay, { once: true });
        nextVideo.addEventListener('error', onError, { once: true });
        nextVideo.src = videoSources.next;
        return () => {cancelled=true;nextVideo.removeEventListener('canplay',onCanPlay);nextVideo.removeEventListener('error',onError);};
      }
    }
  }, [fadeState, videoSources.next, paused]);

  useEffect(() => {
    if (fadeState !== 'fading' || videoSources.next) return;
    const timer = setTimeout(() => setFadeState('idle'), 1000);
    return () => clearTimeout(timer);
  }, [fadeState, videoSources.next]);

  useEffect(() => {
    if (fadeState !== 'idle') return;
    const inactive = activeVideo === 1 ? videoRef2.current : videoRef1.current;
    if (inactive?.hasAttribute('src')) {inactive.pause();inactive.removeAttribute('src');inactive.load();}
  }, [fadeState, activeVideo]);

  const handleActiveError = (video:HTMLVideoElement, slot:1|2) => {
    if(slot!==activeVideo)return; // The pending-switch listener preserves the current theme.
    reportThemeMediaError(video);
    failedSources.current.add(video.currentSrc||video.src);
    const fallback=resolveAssetPath(themeVideos.magicstorm);
    video.pause();video.removeAttribute('src');video.load();
    setVideoSources({active:failedSources.current.has(fallback)?'':fallback,next:''});
    setFadeState('idle');
  };

  return (
    <div
      className={safeStyles.backgroundVideo}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0, // 放在最底层
        overflow: 'hidden',
        backgroundColor: '#000'
      }}
    >
      {/* 视频层 1 */}
      <video
        ref={videoRef1}
        className={safeStyles.video}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          // 移除 transform 和 translate 以防止亚像素模糊
          objectFit: 'cover',
          opacity: activeVideo === 1 ? 1 : 0,
          transition: 'opacity 1s ease-in-out',
          zIndex: activeVideo === 1 ? 1 : 0
        }}
        muted
        loop
        playsInline
        preload="auto"
        onLoadedData={() => console.log('[BackgroundVideo] Video 1 loaded data')}
        onError={(e) => handleActiveError(e.currentTarget,1)}
      />

      {/* 视频层 2 */}
      <video
        ref={videoRef2}
        className={safeStyles.video}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          // 移除 transform 和 translate 以防止亚像素模糊
          objectFit: 'cover',
          opacity: activeVideo === 2 ? 1 : 0,
          transition: 'opacity 1s ease-in-out',
          zIndex: activeVideo === 2 ? 1 : 0
        }}
        muted
        loop
        playsInline
        preload="auto"
        onLoadedData={() => console.log('[BackgroundVideo] Video 2 loaded data')}
        onError={(e) => handleActiveError(e.currentTarget,2)}
      />

      {/* 遮罩层 */}
      <div
        className={safeStyles.overlay}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'linear-gradient(180deg, rgba(0, 0, 0, 0.3) 0%, rgba(0, 0, 0, 0.1) 50%, rgba(0, 0, 0, 0.4) 100%)',
          zIndex: 2,
          opacity
        }}
      />
    </div>
  );
};
