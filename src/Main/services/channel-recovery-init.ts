import { app, dialog } from 'electron';
import { configManager } from './config-manager';
import { assertNoInterruptedLegacyChannelSwitch } from './game-channel-switch';
import { gameChannelFolder } from '../../shared/game-channel';
import { normalizeWar3RootPath } from './war3-path';
import { recoverBranchModToggleAtStartup } from './branch-mod-toggle';
import { assertNoPendingBranchCopy } from './branch-package-copy';
import { getChannelModEnabled, setChannelModEnabled } from './game-channel';
import path from 'path';
import fs from 'fs-extra';

/** Shared startup barrier: old partial moves need inspection, never automatic mutation. */
export const channelRecoveryReady = app.whenReady().then(async () => {
    const gamePath = configManager.get('war3Path');
    if (!gamePath) return;
    let operation = '检查旧版分支切换记录';
    let location = path.join(normalizeWar3RootPath(gamePath), '.quenching-channel-switch.json');
    try {
        await assertNoInterruptedLegacyChannelSwitch(gamePath);
        const root = normalizeWar3RootPath(gamePath);
        for (const channel of ['retail', 'ptr'] as const) {
            const build = path.join(root, gameChannelFolder(channel));
            if (!(await fs.pathExists(build))) continue;
            operation = '检查分支复制记录';
            location = path.join(build, '.quenching', 'branch-copy.json');
            await assertNoPendingBranchCopy(build);
            operation = '恢复 MOD 开关／检查关闭状态';
            location = path.join(build, '.quenching', 'branch-toggle.json');
            const restoredEnabled = await recoverBranchModToggleAtStartup(build, getChannelModEnabled(channel));
            if (restoredEnabled !== null) setChannelModEnabled(channel, restoredEnabled);
        }
    } catch (error) {
        console.error('[GameChannel] Branch transaction requires manual attention:', { gamePath, operation, location }, error);
        const reason = error instanceof Error ? error.message : String(error);
        dialog.showErrorBox('魔兽资源状态检查未通过',
            `魔兽目录路径可能正确，但资源状态检查未完成。\n\n步骤：${operation}\n检查位置：${location}\n原因：${reason.slice(0, 1500)}\n\n为保护现有文件，客户端已停止。请保留相关记录并将此提示或日志发给维护者；不要直接删除记录或覆盖目录。`);
        app.quit();
        throw error;
    }
});
