import React from 'react';
import { reaxel, createReaxable } from 'reaxes';
import { systemLanguage } from '../../shared/system-language';
import { translations } from './i18n/locales';

// 支持的语言配置
export const SUPPORTED_LANGUAGES = {
  'zh-CN': { name: '简体中文', flag: '🇨🇳' },
  'en-US': { name: 'English', flag: '🇺🇸' },
  'ko-KR': { name: '한국어', flag: '🇰🇷' },
  'fr-FR': { name: 'Français', flag: '🇫🇷' },
  'pt-BR': { name: 'Português', flag: '🇧🇷' },
  'ru-RU': { name: 'Русский', flag: '🇷🇺' },
  'es-ES': { name: 'Español', flag: '🇪🇸' }
,
  'pl-PL': { name: 'Polski', flag: '🇵🇱' }
} as const;

export type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES;

// 国际化状态管理
const LANGUAGE_CHANGED_EVENT = 'quenching:language-changed';

export const reaxel_I18n = reaxel(() => {
  const { store, setState } = createReaxable({
    currentLanguage: systemLanguage(typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]),
    isLoading: false
  });

  const setLanguage = (language: SupportedLanguage) => {
    setState({ currentLanguage: language });
    // 保存到本地存储
    localStorage.setItem('quenching-language', language);
    // 同步到 Electron Store (以便主进程可以使用)
    if (window.electronAPI?.setConfig) {
      window.electronAPI.setConfig('language', language);
    }
    window.dispatchEvent(new Event(LANGUAGE_CHANGED_EVENT));
  };

  const t = (key: string, fallbackOrParams?: string | Record<string, string | number>): string => {
    const text = translations[store.currentLanguage]?.[key] || translations['en-US']?.[key]
      || translations['zh-CN']?.[key] || (typeof fallbackOrParams === 'string' ? fallbackOrParams : key);
    if (!fallbackOrParams || typeof fallbackOrParams === 'string') return text;
    return text.replace(/\{\{([\w.]+)\}\}|\{([\w.]+)\}/g, (placeholder, double, single) =>
      Object.prototype.hasOwnProperty.call(fallbackOrParams, double || single) ? String(fallbackOrParams[double || single]) : placeholder);
  };

  // 初始化语言（从本地存储读取）
  const savedLanguage = localStorage.getItem('quenching-language') as SupportedLanguage;
  if (savedLanguage && SUPPORTED_LANGUAGES[savedLanguage]) {
    setState({ currentLanguage: savedLanguage });
  } else if (window.electronAPI?.getConfig) {
    // Electron Store is the durable copy. Browser storage can be cleared when
    // the renderer origin changes or a user resets Chromium site data.
    void window.electronAPI.getConfig('language').then((configuredLanguage: SupportedLanguage) => {
      const currentLanguage = localStorage.getItem('quenching-language') as SupportedLanguage;
      if (currentLanguage && SUPPORTED_LANGUAGES[currentLanguage]) return;
      if (!configuredLanguage || !SUPPORTED_LANGUAGES[configuredLanguage]) return;
      localStorage.setItem('quenching-language', configuredLanguage);
      setState({ currentLanguage: configuredLanguage });
      window.dispatchEvent(new Event(LANGUAGE_CHANGED_EVENT));
    }).catch((error: unknown) => console.warn('Could not restore saved language:', error));
  }

  const statics = {
    supportedLanguages: SUPPORTED_LANGUAGES
  };

  return Object.assign(() => ({
    store,
    setLanguage,
    t,
    supportedLanguages: SUPPORTED_LANGUAGES
  }), {
    store,
    setState,
    setLanguage,
    t,
    statics
  });
});

// React Hook for translations
export const useTranslation = () => {
  const i18n = reaxel_I18n();
  const [state, setState] = React.useState(() => ({ ...i18n.store }));

  React.useEffect(() => {
    const syncLanguage = () => setState({ ...i18n.store });
    window.addEventListener(LANGUAGE_CHANGED_EVENT, syncLanguage);
    syncLanguage();
    return () => window.removeEventListener(LANGUAGE_CHANGED_EVENT, syncLanguage);
  }, [i18n.store]);

  return {
    t: i18n.t,
    currentLanguage: state.currentLanguage,
    isLoading: state.isLoading,
    setLanguage: i18n.setLanguage,
    supportedLanguages: SUPPORTED_LANGUAGES
  };
};
