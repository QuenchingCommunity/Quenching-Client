import { ipcMain } from 'electron';
import { AssetSyncService } from '../services/asset-sync';
import fs from 'fs-extra';
import path from 'node:path';
import { configManager } from '../services/config-manager';
import { getSelectedGameChannel, getSelectedGameFolder, setChannelModEnabled } from '../services/game-channel';
import { normalizeWar3RootPath } from '../services/war3-path';
import { assertNoPendingBranchCopy } from '../services/branch-package-copy';
import { markBranchModUninstalled, recoverBranchModToggle, setBranchModEnabledOnDisk } from '../services/branch-mod-toggle';
import { loadIntegrityManifest } from '../services/mod-integrity-service';
import { assertWarcraftNotRunning } from '../services/mod-update-service';
import { readModUninstallVersions, removeVerifiedModFiles } from '../services/mod-uninstall-service';

export function registerModManagementHandlers() {
    ipcMain.handle('mod:delete', async (_event, war3Path: string) => {
        await assertWarcraftNotRunning();
        const root = normalizeWar3RootPath(war3Path);
        const buildDir = path.join(root, getSelectedGameFolder());
        if (!(await fs.pathExists(buildDir))) throw new Error('当前游戏分支不存在');
        await assertNoPendingBranchCopy(buildDir);
        await recoverBranchModToggle(buildDir, { reconcileDisabled: false });
        const installedVersions = await readModUninstallVersions(buildDir);
        // Legacy full packages have no _patch version marker. Include both
        // bundled inventories to remove files left behind by older upgrades.
        const versions = [...new Set(['3.4', '3.5', ...installedVersions])];
        const inventories = await Promise.all(versions.map(value => loadIntegrityManifest(root, value)));
        if (!inventories.some(Boolean) || installedVersions.some(version => !inventories[versions.indexOf(version)])) {
            throw new Error('MOD 文件清单不可用，未删除任何文件');
        }
        const quenchingDir = path.join(await AssetSyncService.getAssetsDir(), 'quenching');
        const channel = getSelectedGameChannel();
        setChannelModEnabled(channel, false);
        configManager.set('modSettings', { modEnabled: false });
        let deleted = false;
        try {
            const result = await removeVerifiedModFiles(buildDir, inventories.flatMap(item => item ? [item.manifest] : []), quenchingDir);
            deleted = true;
            return { success: true, ...result };
        } finally {
            // Never enable parked files to uninstall them. Retain an off journal
            // even after a partial deletion, so startup cannot reactivate leftovers.
            if (deleted) await markBranchModUninstalled(buildDir);
            else await setBranchModEnabledOnDisk(buildDir, false, { quenchingDir });
        }
    });

    // 重置渲染组件
    ipcMain.handle('mod:reset-rendering', async (event, war3Path: string) => {
        console.log('[ModManagement] Resetting rendering components...');
        // Re-apply client resource paths and replace any unexpected same-name files.
        await AssetSyncService.syncConfiguredAssets(war3Path);
        console.log('[ModManagement] Rendering components reset complete');

        return { success: true };
    });

    // No renderer calls this legacy IPC. Keeping it active would move player
    // folders without a persistent crash journal. Home profile controls replace it.
    ipcMain.handle('mod:toggle-classic-mode', async () => {
        throw new Error('旧版经典模式整目录切换已停用；请使用主页画质模式。');
    });
}
