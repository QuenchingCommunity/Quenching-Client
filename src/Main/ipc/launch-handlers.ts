import { ipcMain, dialog } from 'electron';
import { GameLauncher } from '../services/game-launcher';
import { configManager } from '../services/config-manager';
import { themeService } from '../services/theme-service';
import { AssetSyncService } from '../services/asset-sync';
import fs from 'fs-extra';
import path from 'path';
import { extractCampaignW3nMerged } from '../services/campaign-w3n-merge';
import { readInstalledCampaignMetadata, InstalledCampaignMetadata } from '../services/campaign-metadata';
import { isFullPackageInstalled, isFullPackageInstalledInChannel } from '../services/full-package-service';
import { normalizeWar3RootPath } from '../services/war3-path';
import { getSelectedGameFolder, getChannelModEnabled, setChannelModEnabled, hasGameChannelDirectory } from '../services/game-channel';
import { switchGameChannel } from '../services/game-channel-switch';
import { getInstallSpaceStatus } from '../services/install-space';
import { getArchiveUncompressedBytes } from '../services/archive-extraction';
import { GameChannel } from '../../shared/game-channel';
import { registerLocalFilesInBackground } from '../services/local-files-service';
import { getSelectedGameChannel } from '../services/game-channel';
import { gameChannelFolder } from '../../shared/game-channel';
import { applyBranchModFilesForSwitch, isBranchModDisabled, recoverBranchModToggle } from '../services/branch-mod-toggle';
import { assertNoPendingBranchCopy } from '../services/branch-package-copy';
import { installPackageSources } from '../services/full-package-install';
import { assertWarcraftNotRunning } from '../services/mod-update-service';
import { applyInstalledProfile } from '../services/post-install-profile';
import { resolveModProfile } from '../services/mod-profile';
import { detectWar3Version } from '../services/war3-version';
import { assertWar3VersionSupported } from '../../shared/war3-support';
import { assertShaderProfileSupported } from '../../shared/mod-profile';
import { registerOfflineTestLauncher } from '../services/offline-test-launcher';

function slugFromW3nBasename(w3nPath: string): string {
    const ext = path.extname(w3nPath);
    let base = path.basename(w3nPath, ext);
    base = base.replace(/[<>:"/\\|?*]/g, '_').trim();
    if (!base) base = 'campaign';
    return base;
}

function configuredGameRoot(): string {
    const saved = configManager.get('war3Path');
    if (!saved) throw new Error('Warcraft III directory is not configured');
    return normalizeWar3RootPath(saved);
}

async function branchStates(root: string): Promise<Record<GameChannel, { available: boolean; installed: boolean; enabled: boolean }>> {
    const result = {} as Record<GameChannel, { available: boolean; installed: boolean; enabled: boolean }>;
    for (const channel of ['retail', 'ptr'] as const) {
        const build = path.join(root, gameChannelFolder(channel));
        await assertNoPendingBranchCopy(build);
        const branchExists = await hasGameChannelDirectory(root, channel);
        const installed = branchExists && await isFullPackageInstalledInChannel(root, channel);
        const disabled = branchExists && await isBranchModDisabled(build);
        const configured = configManager.get('channelModEnabled')?.[channel];
        result[channel] = {
            available: branchExists,
            installed,
            // The MOD switch also controls client-provided features when no
            // full package is installed. "installed" is a separate capability.
            enabled: branchExists && !disabled && (typeof configured === 'boolean' ? configured : getChannelModEnabled(channel)),
        };
    }
    return result;
}

export function registerLaunchHandlers() {
    registerOfflineTestLauncher();
    ipcMain.handle('game:launch', async (event, executablePath?: string) => {
        try {
            return await GameLauncher.launchGame(executablePath);
        } catch (e: any) {
            console.error(e);
            // A launch failure can be caused by a missing executable in the
            // selected branch or an unrelated resource. Never forget the
            // player's saved installation root as a side effect.
            throw e;
        }
    });

    ipcMain.handle('game:launch-map', async (event, mapPath: string, difficulty: number) => {
        try {
            return await GameLauncher.launchMap(mapPath, difficulty);
        } catch (e: any) {
            console.error(e);
            throw e;
        }
    });

    ipcMain.handle('campaign:unlock-mode', async () => GameLauncher.getCampaignUnlockMode());

    ipcMain.handle('campaign:unlock', async (_event, mapName?: string) => {
        try {
            return await GameLauncher.unlockCampaign(typeof mapName === 'string' ? mapName.slice(0, 120).replace(/\0/g, '') : undefined);
        } catch (e: any) {
            console.error(e);
            throw e;
        }
    });

    ipcMain.handle('campaign:extract-w3n', async (event, w3nPath: string) => {
        try {
            if (!w3nPath) {
                throw new Error('w3n path is required');
            }
            if (!(await fs.pathExists(w3nPath))) {
                throw new Error(`w3n not found: ${w3nPath}`);
            }
            const ext = path.extname(w3nPath).toLowerCase();
            if (ext !== '.w3n') {
                throw new Error('only .w3n archive is supported');
            }

            const war3Path = configManager.get('war3Path') as string | undefined;
            if (!war3Path || !(await fs.pathExists(war3Path))) {
                throw new Error('Configure Warcraft III installation path before importing a campaign (needed for _QMCampaign folder).');
            }
            const slug = slugFromW3nBasename(w3nPath);
            const finalOutputDir = path.join(war3Path, '_QMCampaign', slug);

            const { outputDir: out, maps } = await extractCampaignW3nMerged(w3nPath, finalOutputDir, (progress) => {
                event.sender.send('campaign:extract-progress', progress);
            });
            return { success: true, outputDir: out, maps };
        } catch (e: any) {
            console.error('[Campaign] Failed to extract w3n:', e);
            throw e;
        }
    });

    ipcMain.handle('campaign:list-installed', async () => {
        try {
            const war3Path = configManager.get('war3Path') as string | undefined;
            if (!war3Path || !(await fs.pathExists(war3Path))) {
                return { campaigns: [] as Array<{ id: string; path: string; mapCount: number } & InstalledCampaignMetadata> };
            }
            const root = path.join(war3Path, '_QMCampaign');
            if (!(await fs.pathExists(root))) {
                return { campaigns: [] };
            }
            const entries = await fs.readdir(root, { withFileTypes: true });
            const language = configManager.get('language') as string | undefined;
            const campaigns: Array<{ id: string; path: string; mapCount: number } & InstalledCampaignMetadata> = [];
            for (const ent of entries) {
                if (!ent.isDirectory()) continue;
                const campPath = path.join(root, ent.name);
                const w3f = path.join(campPath, 'war3campaign.w3f');
                const merged = path.join(campPath, '_merged');
                if (!(await fs.pathExists(w3f)) || !(await fs.pathExists(merged))) continue;
                const files = await fs.readdir(merged);
                const mapCount = files.filter((f) => /\.w3x$/i.test(f) || /\.w3m$/i.test(f)).length;
                if (mapCount === 0) continue;
                const metadata = await readInstalledCampaignMetadata(campPath, language);
                campaigns.push({ id: ent.name, path: campPath, mapCount, ...metadata });
            }
            campaigns.sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id, undefined, { numeric: true, sensitivity: 'base' }));
            return { campaigns };
        } catch (e) {
            console.error('[Campaign] list-installed failed:', e);
            return { campaigns: [] };
        }
    });

    ipcMain.handle('game:select-path', async () => {
        const isMac = process.platform === 'darwin';
        const result = await dialog.showOpenDialog({
            properties: isMac ? ['openDirectory', 'openFile'] : ['openDirectory'],
            title: isMac ? '请选择魔兽争霸III安装目录或 Warcraft III.app' : '请选择魔兽争霸III安装目录 (包含 Warcraft III.exe)',
            filters: isMac ? [{ name: 'Applications', extensions: ['app'] }] : []
        });

        if (!result.canceled && result.filePaths.length > 0) {
            let selectedPath = result.filePaths[0];

            // 如果用户直接选择了 .app 文件，我们将路径设为其父目录（root）
            if (isMac && selectedPath.endsWith('.app')) {
                selectedPath = path.dirname(selectedPath);
            }

            // The native folder picker lets users enter `_retail_`. Internally
            // we always store the parent installation root.
            selectedPath = normalizeWar3RootPath(selectedPath);

            const hasRetailDir = await fs.pathExists(path.join(selectedPath, '_retail_'));
            const hasPtrDir = await fs.pathExists(path.join(selectedPath, '_ptr_'));

            if (hasRetailDir || hasPtrDir) {
                if (hasRetailDir !== hasPtrDir) {
                    const availableChannel: GameChannel = hasPtrDir ? 'ptr' : 'retail';
                    await switchGameChannel(selectedPath, availableChannel);
                }
                configManager.set('war3Path', selectedPath);
                return selectedPath;
            }

            const possibleExes = isMac ? [
                path.join(selectedPath, 'Warcraft III.app'),
                path.join(selectedPath, '_retail_', 'Warcraft III.app'),
                path.join(selectedPath, '_ptr_', 'Warcraft III.app'),
            ] : [
                path.join(selectedPath, 'Warcraft III.exe'),
                path.join(selectedPath, '_retail_', 'x86_64', 'Warcraft III.exe'),
                path.join(selectedPath, '_ptr_', 'x86_64', 'Warcraft III.exe'),
                path.join(selectedPath, 'x86_64', 'Warcraft III.exe')
            ];

            let isValid = false;
            for (const exe of possibleExes) {
                if (await fs.pathExists(exe)) {
                    isValid = true;
                    break;
                }
            }

            if (isValid) {
                configManager.set('war3Path', selectedPath);
                return selectedPath;
            }

            const msg = isMac
                ? '所选目录中未找到 _retail_ / _ptr_ 文件夹或 Warcraft III.app'
                : '所选目录中未找到 _retail_ / _ptr_ 文件夹或 Warcraft III.exe';
            dialog.showErrorBox('路径无效', `${msg}，请重新选择正确的游戏安装目录。`);
            return null;
        }
        return null;
    });

    ipcMain.handle('config:get', (event, key) => {
        return configManager.get(key);
    });

    ipcMain.handle('config:set', (event, key, value) => {
        if (key === 'gameChannel') throw new Error('Use game:switch-channel to change game branches safely');
        return configManager.set(key, value);
    });

    ipcMain.handle('game:switch-channel', async (_event, channel: GameChannel) => {
        const root = configManager.get('war3Path');
        if (!root) throw new Error('Choose a Warcraft III folder before switching');
        await switchGameChannel(root, channel);
        return true;
    });

    ipcMain.handle('mod:get-branch-states', async () => branchStates(configuredGameRoot()));

    ipcMain.handle('mod:set-branch-enabled', async (_event, channel: GameChannel, enabled: boolean) => {
        if (channel !== 'retail' && channel !== 'ptr' || typeof enabled !== 'boolean') throw new Error('Invalid branch toggle request');
        const root = configuredGameRoot();
        await assertWarcraftNotRunning();
        const build = path.join(root, gameChannelFolder(channel));
        if (!(await hasGameChannelDirectory(root, channel))) throw new Error('The selected game branch is not installed');
        if (enabled) {
            if (channel === getSelectedGameChannel()) {
                assertShaderProfileSupported(await resolveModProfile(root, configManager.get('modSettings') || {}));
            } else {
                assertWar3VersionSupported(await detectWar3Version(root, channel));
            }
        }
        await assertNoPendingBranchCopy(build);
        await recoverBranchModToggle(build);
        await applyBranchModFilesForSwitch(build, enabled, {
            quenchingDir: path.join(await AssetSyncService.getAssetsDir(), 'quenching'),
        });
        setChannelModEnabled(channel, enabled);
        if (enabled && channel === getSelectedGameChannel()) {
            await AssetSyncService.ensurePostProcessingConfig(root);
            if (await isFullPackageInstalled(root)) await applyInstalledProfile(root);
        }
        return { needsZip: false, states: await branchStates(root) };
    });

    ipcMain.handle('game:ensure-local-files', () => {
        // After the window is up, write both branches. Game launch does not touch the registry.
        registerLocalFilesInBackground('retail');
        registerLocalFilesInBackground('ptr');
        return true;
    });

    ipcMain.handle('mod:install-space-status', async (_event, zipPath?: string) => {
        const root = configManager.get('war3Path');
        if (!root) return null;
        const bytes = zipPath ? await getArchiveUncompressedBytes(zipPath) : undefined;
        if (bytes !== undefined) configManager.set('lastFullPackageBytes', bytes);
        return getInstallSpaceStatus(root, bytes);
    });

    ipcMain.handle('theme:apply', async (event, themeId: string) => {
        return await themeService.applyThemeToGame(themeId);
    });
    ipcMain.handle('mod:get-full-package-status', async (event, explicitPath?: string) => {
        const war3Path = (explicitPath || (configManager.get('war3Path') as string | undefined));
        return await isFullPackageInstalled(war3Path);
    });

    ipcMain.handle('mod:install-full-package', async (event, zipInput: string | string[]) => {
        const war3Path = configManager.get('war3Path') as string | undefined;

        if (!war3Path) {
            return {
                success: false,
                error: 'noWar3Path'
            };
        }

        const requestedZips = Array.isArray(zipInput) ? zipInput : zipInput ? [zipInput] : [];
        if (!requestedZips.length || !(await Promise.all(requestedZips.map(file => fs.pathExists(file)))).every(Boolean)) {
            return {
                success: false,
                error: 'noZip'
            };
        }

        let packageCopied = false;
        const installProgress = (percent: number, message: string) => {
            try { if (!event.sender.isDestroyed?.()) event.sender.send('mod:install-progress', { percent, message }); }
            catch (error) { console.warn('[FullPackage] Could not notify renderer:', error); }
        };
        try {
            await assertWarcraftNotRunning();
            assertShaderProfileSupported(await resolveModProfile(war3Path, configManager.get('modSettings') || {}));
            const normalizedWar3Path = normalizeWar3RootPath(war3Path);
            if (normalizedWar3Path !== war3Path) {
                configManager.set('war3Path', normalizedWar3Path);
            }
            const channel = getSelectedGameChannel();
            const targetPath = path.join(normalizedWar3Path, gameChannelFolder(channel));
            if (!(await fs.pathExists(targetPath))) {
                return { success: false, error: 'wrongChannel' };
            }
            await assertNoPendingBranchCopy(targetPath);
            // The extraction stage and installed files share a drive. Check
            // the fixed reserve now; the archive size is counted while it is
            // extracted, so there is no separate ZIP directory scan.
            const space = await getInstallSpaceStatus(normalizedWar3Path, 0);
            if (space.insufficient) {
                return { success: false, error: 'insufficientSpace', ...space };
            }
            await recoverBranchModToggle(targetPath);
            const modEnabled = getChannelModEnabled(channel) && !await isBranchModDisabled(targetPath);
            let prepared = false;
            let archiveBytes: number;
            try {
                archiveBytes = await installPackageSources(requestedZips, targetPath, (percent, message) => {
                    installProgress(percent, message);
                }, async () => {
                    // Merge the package with restored files, then retain the user's switch state.
                    await applyBranchModFilesForSwitch(targetPath, true);
                    prepared = true;
                });
                packageCopied = true;
            } finally {
                if (prepared && !modEnabled) await applyBranchModFilesForSwitch(targetPath, false);
            }
            configManager.set('lastFullPackageBytes', archiveBytes);
            setChannelModEnabled(channel, modEnabled);
            const warnings = await applyInstalledProfile(normalizedWar3Path, {
                forceUnitSkinBaseline: true,
                restoreSkinsOnly: !modEnabled,
                onProgress: (message) => installProgress(99, message),
            });
            installProgress(100, '安装完成');
            return {
                success: true,
                skipped: false,
                configurationError: warnings.join('；') || undefined,
            };
        } catch (e: any) {
            console.error('[FullPackage] ZIP installation failed:', e);
            if (packageCopied) return { success: true, skipped: false,
                configurationError: `资源包已安装，后续配置未完成：${e?.message || String(e)}` };
            return {
                success: false,
                error: e && e.message ? e.message : String(e)
            };
        }
    });

    ipcMain.handle('mod:sync-assets', async (event, requestedWar3Path?: string) => {
        try {
            const war3Path = requestedWar3Path || configManager.get('war3Path');
            if (!war3Path) {
                throw new Error('Warcraft III directory is not configured');
            }
            const selectedBuild = path.join(war3Path, getSelectedGameFolder());
            const otherBuild = path.join(war3Path, getSelectedGameFolder() === '_ptr_' ? '_retail_' : '_ptr_');
            if (!(await fs.pathExists(selectedBuild)) && await fs.pathExists(otherBuild)) {
                throw new Error('Switch to the installed game branch before syncing assets');
            }
            await AssetSyncService.syncConfiguredAssets(war3Path, (step, percent) => {
                event.sender.send('mod:profile-progress', { step, percent });
            });
        } catch (error) {
            console.error('[LaunchHandlers] Failed to sync assets:', error);
            // Optionally rethrow if you want the renderer to know it failed
            throw error;
        }
    });
}
