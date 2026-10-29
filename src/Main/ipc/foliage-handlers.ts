import { ipcMain } from 'electron';
import { applyFoliageSettings } from '../services/foliage-service';
import { createSettingsProgressReporter } from '../../shared/settings-progress';

export function registerFoliageHandlers() {
    console.log('[Foliage] Foliage handlers registered.');

    ipcMain.handle(
        'foliage:update-settings',
        async (event, war3Path: string, enabled: boolean, terrainMode?: string, requestId?: string) => {
            const report = createSettingsProgressReporter((step, percent) => {
                if (event?.sender && !event.sender.isDestroyed?.()) event.sender.send('mod:profile-progress', { step, percent, operation: 'foliage', requestId });
            });
            console.log(`\n>>> [Foliage] Updating foliage: ${enabled ? 'ON' : 'OFF'}`);
            try {
                if (!war3Path) throw new Error('未提供魔兽路径');

                await applyFoliageSettings(war3Path, enabled, terrainMode, percent => report('environment', percent));
                console.log(`[Foliage] SUCCESSFULLY updated foliage to ${enabled}`);
                return true;
            } catch (error) {
                console.error('[Foliage] Failed to update foliage settings:', error);
                throw error;
            }
        }
    );
}

export { syncFoliageOnStartup } from '../services/foliage-service';
