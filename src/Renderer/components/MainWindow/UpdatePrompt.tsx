import React from 'react';
import { Modal } from 'antd';
import type { CombinedUpdatePrompt } from '../../../shared/combined-update-prompt';

export const UPDATE_DIALOG_CLASS = 'quenching-update-dialog';

/** One confirmation for automatic checks, manual checks and update buttons. */
export function showUpdatePrompt({ prompt, clientUpToDate, t, onConfirm, afterClose }: {
  prompt: CombinedUpdatePrompt;
  clientUpToDate: boolean;
  t: (key: string, fallback?: string) => string;
  onConfirm: () => void;
  afterClose: () => void;
}) {
  const clientCurrent = prompt.client?.currentVersion.replace(/^v/i, '');
  const clientTarget = prompt.client?.targetVersion.replace(/^v/i, '');
  const modCurrent = prompt.mod?.currentVersion?.replace(/^v/i, '') || t('main.home.notInstalled', '未安装或无法识别');
  const modTarget = prompt.mod?.targetVersion.replace(/^v/i, '');
  const automatic = prompt.client?.automatic || prompt.mod?.automatic;
  const manual = (prompt.client && !prompt.client.automatic) || (prompt.mod && !prompt.mod.automatic);
  return Modal.confirm({
    className: UPDATE_DIALOG_CLASS,
    centered: true,
    title: t('main.home.combinedUpdateTitle', '发现可用更新'),
    content: (
      <div style={{ display: 'grid', gap: 12, paddingTop: 8 }}>
        {prompt.client && (
          <div>
            <strong>{t('main.home.clientLabel', '客户端')}</strong>
            <div>{t('main.home.currentVersion', '当前版本')}：v{clientCurrent}</div>
            <div>{t('main.home.latestVersion', '最新版本')}：v{clientTarget}</div>
            {!prompt.client.automatic && <small>{t('main.home.clientManualUpdate', '该版本需要重新下载便携客户端。')}</small>}
          </div>
        )}
        {prompt.mod && (
          <div>
            {!prompt.client && clientUpToDate && (
              <p>{t('main.home.clientCurrentModPending', '客户端已是最新版本；以下是尚未完成的 MOD 资源包更新。')}</p>
            )}
            <strong>{t('main.home.modLabel', 'MOD 资源包')}</strong>
            <div>{t('main.home.currentVersion', '当前版本')}：{prompt.mod.currentVersion ? `v${modCurrent}` : modCurrent}</div>
            <div>{t('main.home.latestVersion', '最新版本')}：v{modTarget}</div>
            {!prompt.mod.automatic && <small>{t('main.home.modManualUpdate', '当前安装无法使用增量补丁，需要重新获取完整包。')}</small>}
          </div>
        )}
        <div>{prompt.client?.automatic && prompt.mod?.automatic
          ? t('main.home.combinedUpdateOrder', '确定后将先更新 MOD 资源包，再更新客户端并自动重启。')
          : automatic
            ? manual
              ? t('main.home.combinedUpdateMixed', '确定后会执行可自动完成的更新，并打开需要手动下载的页面。')
              : t('main.home.combinedUpdateAutomatic', '确定后将下载并安装所列更新。')
            : t('main.home.combinedUpdateManual', '确定后将打开对应的下载页面。')}</div>
      </div>
    ),
    okText: automatic ? t('main.home.confirmUpdate', '确定并更新') : t('main.home.openDownload', '前往下载'),
    cancelText: t('main.home.later', '稍后'),
    // Close confirmation before the download overlay; AntD must not await it.
    onOk: () => { onConfirm(); },
    afterClose,
  });
}
