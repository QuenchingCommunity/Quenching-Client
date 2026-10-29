import type { BrowserWindow } from 'electron';
import path from 'node:path';
import { configManager } from './config-manager';
import { getChannelModEnabled, getSelectedGameChannel, hasGameChannelDirectory } from './game-channel';
import { isThirdPartyQuenchingPaused } from './third-party-resources';
import { readCurrentModVersion } from './mod-integrity-service';
import { getInstalledModState } from './mod-update-service';
import { AssetSyncService, syncLightingResources } from './asset-sync';
import { startupResourceBarrier } from './startup-resource-barrier';
import { UIService } from './ui-service';

export type StartupRenderingResult = { status: 'applied' | 'skipped' | 'failed'; reason?: string; error?: string };

export async function applyStartupRendering(): Promise<StartupRenderingResult> {
  return startupResourceBarrier.exclusive<StartupRenderingResult>(async () => {
    // Read after earlier IPC operations finish: do not apply an obsolete channel/settings snapshot.
    const gamePath = configManager.get('war3Path');
    const channel = getSelectedGameChannel();
    if (!gamePath || !getChannelModEnabled(channel)) return { status: 'skipped', reason: 'mod-disabled-or-no-directory' };
    if (!await hasGameChannelDirectory(gamePath, channel)) return { status: 'skipped', reason: 'branch-missing' };
    const settings = configManager.get('modSettings') || {};
    if (settings.graphicsSelection === 'sd' || settings.classicMode === true) return { status: 'skipped', reason: 'classic-mode' };
    if (await isThirdPartyQuenchingPaused(gamePath)) return { status: 'skipped', reason: 'third-party-paused' };
    if (!await readCurrentModVersion(gamePath) && (await getInstalledModState(gamePath))?.sequence === 34) {
      return { status: 'skipped', reason: 'legacy-package' };
    }
    // These are client-bundled resources; basic rendering does not require a full package marker.
    const assets = path.join(await AssetSyncService.getAssetsDir(["dnc","skin"]), 'quenching');
    await syncLightingResources(gamePath, assets, settings, undefined, { forceEnvironment: true });
    // UI refresh belongs to startup/profile application, never a settings read.
    // Its version/style marker makes an unchanged UI a no-op.
    await UIService.syncConfiguredUI(gamePath);
    return { status: 'applied' };
  }).catch((error): StartupRenderingResult => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[StartupRendering] Background refresh failed:', error);
    return { status: 'failed', error: detail };
  });
}

let scheduled = false;
/** Call only after loadFile/loadURL succeeds. Never await this from window creation. */
export function scheduleStartupRendering(window: BrowserWindow): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    if (window.isDestroyed()) return;
    void applyStartupRendering().then(result => {
      console.log('[StartupRendering]', result.status, result.reason || '');
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send('mod:startup-rendering-result', result);
      }
    }).catch(error => console.error('[StartupRendering] Notification failed:', error));
  }, 0);
}
