import { resourcePath } from '../../shared/bundled-resource-paths.mjs';
import { getChannelModEnabled, getSelectedGameChannel, getSelectedGameFolder, hasGameChannelDirectory } from './game-channel';
import { spawn, type SpawnOptions } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { configManager } from './config-manager';
import { AssetSyncService } from './asset-sync';
import { syncBundledResourceFiles } from './managed-resource-files';
import { isFullPackageInstalled } from './full-package-service';
import { resolveModProfile } from './mod-profile';
import { assertShaderProfileSupported } from '../../shared/mod-profile';
import { detectWar3Version, readShaderPackMarker } from './war3-version';
import { UIService } from './ui-service';
import { setBranchModEnabledOnDisk } from './branch-mod-toggle';
import { app } from 'electron';
import { launchViaBattleNet, resolveBattleNetExe } from './battle-net-launcher';
import { writeMapName } from './map-name';

async function assertSelectedGameBuild(gamePath: string): Promise<void> {
    if (!(await hasGameChannelDirectory(gamePath, getSelectedGameChannel()))) {
        throw new Error(`${getSelectedGameFolder()} is not installed in the selected Warcraft III folder`);
    }
    await resolveModProfile(gamePath, configManager.get('modSettings') || {});
}

function spawnGameProcess(command: string, args: string[], options: SpawnOptions): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, options);
        // Missing/blocked executables fail asynchronously. Let the launch IPC
        // reject so the existing renderer error prompt can report the failure.
        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
    });
}

export class GameLauncher {

    private static async supportsBattleNetLaunch(gamePath: string): Promise<boolean> {
        if (process.platform !== 'win32' && process.platform !== 'darwin') return false;
        const detected = await detectWar3Version(gamePath);
        return detected.source !== 'unknown' && (detected.parts[0] || 0) >= 3;
    }

    static async prepareLaunchAssets(gamePath: string): Promise<void> {
        if (!getChannelModEnabled(getSelectedGameChannel())) {
            await setBranchModEnabledOnDisk(path.join(gamePath, getSelectedGameFolder()), false, {
                quenchingDir: path.join(await AssetSyncService.getAssetsDir(["camp","skin","dnc"]), 'quenching'),
            });
            return;
        }
        const settings = configManager.get('modSettings') || {};
        const profile = await resolveModProfile(gamePath, settings);
        // Validate even when an old PTR marker happens to name the same pack.
        assertShaderProfileSupported(profile);
        const shadersDir = path.join(gamePath, getSelectedGameFolder(), 'shaders');
        if (await readShaderPackMarker(shadersDir) !== profile.shaderPack) {
            if (!(await isFullPackageInstalled(gamePath))) return;
            await AssetSyncService.syncConfiguredAssets(gamePath);
        }
        await UIService.syncConfiguredUI(gamePath);
    }

    /**
     * Custom .w3n campaigns keep war3campImported / music / sound next to the archive;
     * Reforged resolves them from _retail_. Mirrors legacy client copy step after per-map merge.
     */
    private static async syncCampaignAssetFoldersToRetail(campaignRoot: string, gamePath: string): Promise<void> {
        const retailPath = path.join(gamePath, getSelectedGameFolder());
        if (!(await fs.pathExists(retailPath))) {
            console.warn('[GameLauncher] _retail_ not found; skip campaign folder sync');
            return;
        }
        for (const folderName of ['war3campImported', 'music', 'sound'] as const) {
            const src = path.join(campaignRoot, folderName);
            const dest = path.join(retailPath, folderName);
            if (await fs.pathExists(src)) {
                await syncBundledResourceFiles(dest, [{ source: src }], [{ source: src }], '.quenching-campaign-files');
            }
        }
    }

    /**
     * Launch Warcraft III with arguments
     */
    static async launchGame(executablePath?: string): Promise<boolean> {
        const isMac = process.platform === 'darwin';
        let exePath = executablePath;
        const gamePath = configManager.get('war3Path');

        if (!gamePath || !fs.existsSync(gamePath)) {
            throw new Error("Warcraft III path is not configured or does not exist.");
        }
        await assertSelectedGameBuild(gamePath);

        if (!exePath) {
            if (isMac) {
                // macOS logic
                const possibleMacExes = [
                    path.join(gamePath, getSelectedGameFolder(), 'x86_64', 'Warcraft III.app'),
                    path.join(gamePath, getSelectedGameFolder(), 'Warcraft III.app'),
                    ...(getSelectedGameChannel() === 'retail' ? [path.join(gamePath, 'Warcraft III.app')] : []),
                ];
                for (const p of possibleMacExes) {
                    if (fs.existsSync(p)) {
                        exePath = p;
                        break;
                    }
                }
            } else {
                // Windows logic
                const possibleWinExes = [
                    path.join(gamePath, getSelectedGameFolder(), 'x86_64', 'Warcraft III.exe'),
                    ...(getSelectedGameChannel() === 'retail' ? [
                        path.join(gamePath, 'x86_64', 'Warcraft III.exe'),
                        path.join(gamePath, 'Warcraft III Launcher.exe'),
                        path.join(gamePath, 'Warcraft III.exe'),
                    ] : []),
                ];
                for (const p of possibleWinExes) {
                    if (fs.existsSync(p)) {
                        exePath = p;
                        break;
                    }
                }
            }
        }

        if (!exePath || !fs.existsSync(exePath)) {
            if (isMac && gamePath && fs.existsSync(path.join(gamePath, getSelectedGameFolder()))) {
                const retailApp = path.join(gamePath, getSelectedGameFolder(), 'Warcraft III.app');
                if (fs.existsSync(retailApp)) {
                    exePath = retailApp;
                }
            }
        }

        if (!exePath || !fs.existsSync(exePath)) {
            throw new Error(`Could not find Warcraft III executable at: ${exePath || 'configured path'}`);
        }

        await this.prepareLaunchAssets(gamePath);

        // Resource settings must be applied before either Battle.net or direct launch.
        if (!executablePath && await this.supportsBattleNetLaunch(gamePath) && await launchViaBattleNet(gamePath, getSelectedGameChannel())) {
            return true;
        }

        console.log(`Launching game from: ${exePath}`);

        try {
            if (isMac) {
                // Use 'open' on macOS to launch the app bundle
                await spawnGameProcess('open', [exePath, '--args', '-launch', '-uid', 'w3'], {
                    detached: true,
                    stdio: 'ignore'
                });
            } else {
                await spawnGameProcess(exePath, ['-launch', '-uid', 'w3'], {
                    detached: true,
                    cwd: path.dirname(exePath),
                    stdio: 'ignore'
                });
            }
            return true;
        } catch (e) {
            console.error("Failed to launch game process", e);
            throw e;
        }
    }

    /**
     * Launch Warcraft III with a specific map and difficulty
     */
    static async launchMap(mapPath: string, difficulty: number): Promise<boolean> {
        const isMac = process.platform === 'darwin';
        let gamePath = configManager.get('war3Path');

        if (!gamePath || !fs.existsSync(gamePath)) {
            throw new Error("Warcraft III path is not configured or does not exist.");
        }
        await assertSelectedGameBuild(gamePath);

        let exePath = '';
        if (isMac) {
            const possibleMacExes = [
                path.join(gamePath, getSelectedGameFolder(), 'x86_64', 'Warcraft III.app'),
                path.join(gamePath, getSelectedGameFolder(), 'Warcraft III.app'),
                ...(getSelectedGameChannel() === 'retail' ? [path.join(gamePath, 'Warcraft III.app')] : []),
            ];
            for (const p of possibleMacExes) {
                if (fs.existsSync(p)) {
                    exePath = p;
                    break;
                }
            }
        } else {
            const possibleWinExes = [
                path.join(gamePath, getSelectedGameFolder(), 'x86_64', 'Warcraft III.exe'),
                ...(getSelectedGameChannel() === 'retail' ? [
                    path.join(gamePath, 'x86_64', 'Warcraft III.exe'),
                    path.join(gamePath, 'Warcraft III.exe'),
                ] : []),
            ];
            for (const p of possibleWinExes) {
                if (fs.existsSync(p)) {
                    exePath = p;
                    break;
                }
            }
        }

        if (!exePath || !fs.existsSync(exePath)) {
            throw new Error(`Could not find Warcraft III executable in: ${gamePath}`);
        }

        await this.prepareLaunchAssets(gamePath);

        console.log(`Launching map from: ${exePath} with map: ${mapPath}`);

        const mapDir = path.dirname(mapPath);
        if (path.basename(mapDir) === '_merged') {
            const campaignRoot = path.dirname(mapDir);
            const w3f = path.join(campaignRoot, 'war3campaign.w3f');
            if (await fs.pathExists(w3f)) {
                await GameLauncher.syncCampaignAssetFoldersToRetail(campaignRoot, gamePath);
            }
        }

        try {
            const args = [
                '-launch',
                '-loadfile', mapPath,
                '-mapdiff', difficulty.toString(),
                '-testmapprofile', 'WorldEdit'
            ];

            if (isMac) {
                await spawnGameProcess('open', [exePath, '--args', ...args], {
                    detached: true,
                    stdio: 'ignore'
                });
            } else {
                await spawnGameProcess(exePath, args, {
                    detached: true,
                    cwd: path.dirname(exePath),
                    stdio: 'ignore'
                });
            }
            return true;
        } catch (e) {
            console.error("Failed to launch game process", e);
            throw e;
        }
    }

    /** Battle.net users run the prepared map from Custom Game; other routes retain -loadfile. */
    static async getCampaignUnlockMode(): Promise<'battlenet' | 'direct'> {
        const gamePath = configManager.get('war3Path');
        if (!gamePath || !await this.supportsBattleNetLaunch(gamePath)) return 'direct';
        return await resolveBattleNetExe(gamePath, getSelectedGameChannel()) ? 'battlenet' : 'direct';
    }

    /** Prepare the built-in unlock map; only its copied version receives a localized name. */
    static async unlockCampaign(mapName?: string): Promise<boolean> {
        const isMac = process.platform === 'darwin';
        const gamePath = configManager.get('war3Path');

        if (!gamePath || !fs.existsSync(gamePath)) {
            throw new Error("Warcraft III path is not configured or does not exist.");
        }
        await assertSelectedGameBuild(gamePath);

        let exePath = '';
        if (isMac) {
            const possibleMacExes = [
                path.join(gamePath, getSelectedGameFolder(), 'x86_64', 'Warcraft III.app'),
                path.join(gamePath, getSelectedGameFolder(), 'Warcraft III.app'),
                ...(getSelectedGameChannel() === 'retail' ? [path.join(gamePath, 'Warcraft III.app')] : []),
            ];
            for (const p of possibleMacExes) {
                if (fs.existsSync(p)) {
                    exePath = p;
                    break;
                }
            }
        } else {
            const possibleWinExes = [
                path.join(gamePath, getSelectedGameFolder(), 'x86_64', 'Warcraft III.exe'),
                ...(getSelectedGameChannel() === 'retail' ? [
                    path.join(gamePath, 'x86_64', 'Warcraft III.exe'),
                    path.join(gamePath, 'Warcraft III.exe'),
                ] : []),
            ];
            for (const p of possibleWinExes) {
                if (fs.existsSync(p)) {
                    exePath = p;
                    break;
                }
            }
        }

        if (!exePath || !fs.existsSync(exePath)) {
            throw new Error(`Could not find Warcraft III executable in: ${gamePath}`);
        }

        await this.prepareLaunchAssets(gamePath);

        const assetsDir = await AssetSyncService.getAssetsDir(["camp","skin","dnc"]);
        const sourceMap = resourcePath(path.join(assetsDir, 'quenching'), 'camp', 'cfix.w3x');
        if (!(await fs.pathExists(sourceMap))) {
            throw new Error(`Campaign unlock map not found: ${sourceMap}`);
        }

        // Battle.net cannot pass -loadfile. Prepare a named copy for Custom Game instead.
        if (await this.supportsBattleNetLaunch(gamePath) && await resolveBattleNetExe(gamePath, getSelectedGameChannel())) {
            const gameName = getSelectedGameChannel() === 'ptr' ? 'Warcraft III Public Test' : 'Warcraft III';
            const userRoot = isMac ? path.join(app.getPath('appData'), 'Blizzard') : app.getPath('documents');
            const userMap = path.join(userRoot, gameName, 'Maps', 'Quenching', 'cfix.w3x');
            await fs.copy(sourceMap, userMap, { overwrite: true });
            await writeMapName(userMap, mapName || 'Quenching: Unlock Campaign');
            if (await launchViaBattleNet(gamePath, getSelectedGameChannel())) return true;
        }

        const exeDir = path.dirname(exePath);
        const targetMap = path.join(exeDir, 'cfix.w3x');
        await fs.copy(sourceMap, targetMap, { overwrite: true });

        console.log(`Launching campaign unlock map from: ${exePath} -> ${targetMap}`);

        const loadFile = isMac ? targetMap : './cfix.w3x';
        const args = [
            '-launch',
            '-loadfile', loadFile,
            '-mapdiff', '1',
            '-testmapprofile', 'WorldEdit',
            '-fixedseed', '1'
        ];

        try {
            if (isMac) {
                await spawnGameProcess('open', [exePath, '--args', ...args], {
                    detached: true,
                    stdio: 'ignore'
                });
            } else {
                await spawnGameProcess(exePath, args, {
                    detached: true,
                    cwd: exeDir,
                    stdio: 'ignore'
                });
            }
            return true;
        } catch (e) {
            console.error("Failed to launch campaign unlock map", e);
            throw e;
        }
    }
}
