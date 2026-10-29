import { ipcMain } from 'electron';
import { applyModUpdate, getInstalledModState, getModUpdateStatus } from '../services/mod-update-service';
import { verifyModIntegrity } from '../services/mod-integrity-service';
import { getChannelModEnabled, getSelectedGameChannel, getSelectedGameDir } from '../services/game-channel';
import { isBranchModDisabled } from '../services/branch-mod-toggle';
import { applyInstalledProfile } from '../services/post-install-profile';
import { configManager } from '../services/config-manager';
import { resolveModProfile } from '../services/mod-profile';
import { assertShaderProfileSupported } from '../../shared/mod-profile';

function assertWar3Path(war3Path: unknown): asserts war3Path is string {
  if (typeof war3Path !== 'string' || !war3Path.trim()) throw new Error('未提供魔兽路径');
}

export function registerModUpdateHandlers() {
  ipcMain.handle('mod-update:get-status', async (_event, war3Path: string) => {
    assertWar3Path(war3Path);
    return getModUpdateStatus(war3Path);
  });

  ipcMain.handle('mod-update:apply', async (event, war3Path: string) => {
    assertWar3Path(war3Path);
    if (!getChannelModEnabled(getSelectedGameChannel()) || await isBranchModDisabled(getSelectedGameDir(war3Path))) {
      throw new Error('Enable the selected branch MOD before applying an update');
    }
    assertShaderProfileSupported(await resolveModProfile(war3Path, configManager.get('modSettings') || {}));
    const result = await applyModUpdate(war3Path, {
      onProgress: (progress) => {
        // File installation finishes before the selected profile is reapplied.
        if (progress.phase !== 'complete' && !event.sender.isDestroyed()) event.sender.send('mod-update:progress', progress);
      },
    });
    if (!result.applied && !result.appliedPatches) return result;
    // The patch is already committed. Report profile failures separately so
    // users never mistake "updated files" for "settings applied".
    if (!event.sender.isDestroyed()) event.sender.send('mod-update:progress', {
      phase: 'finalizing', percent: 99, message: '正在应用当前资源设置',
    });
    const warnings = await applyInstalledProfile(war3Path);
    if (result.applied && !event.sender.isDestroyed()) event.sender.send('mod-update:progress', {
      phase: 'complete', percent: 100, message: warnings.length ? '更新完成，部分设置未生效' : 'MOD 更新完成',
    });
    return { ...result, configurationError: warnings.join('；') || undefined };
  });

  ipcMain.handle('mod-update:get-installed-state', async (_event, war3Path: string) => {
    assertWar3Path(war3Path);
    return getInstalledModState(war3Path);
  });

  ipcMain.handle('mod-update:verify-integrity', async (_event, war3Path: string, fullHash = false) => {
    assertWar3Path(war3Path);
    if (typeof fullHash !== 'boolean') throw new Error('完整性校验参数无效');
    return verifyModIntegrity(war3Path, fullHash ? 'full' : 'presence');
  });
}
