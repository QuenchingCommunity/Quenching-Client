import {defaultHdrExposure,resolveHdrExposure} from '../../shared/hdr-exposure';
import { ipcMain } from 'electron';
import path from 'path';
import { configManager } from '../services/config-manager';
import { AssetSyncService, syncLightingResources } from '../services/asset-sync';
import { normalizeBrightnessLevel } from '../services/dnc-lighting';
import { createSettingsProgressReporter } from '../../shared/settings-progress';
import { resolveRetailDir } from '../services/full-package-service';
import { effectiveLightingMode, getDncResourcePath, resolveModProfile } from '../services/mod-profile';
import { assertShaderProfileSupported, isVersion30OrLater } from '../../shared/mod-profile';
import { patchRotatingUnitLighting } from '../services/rotating-lighting';
import { withResourceDirectory } from '../services/resource-directory-queue';
import { getChannelModEnabled, getSelectedGameChannel } from '../services/game-channel';
import { validateUnitLightAngle } from '../../shared/dnc-rotation';
import { syncAtmosphericLight } from '../services/atmospheric-light';

export function registerMdlHandlers() {
    ipcMain.handle('mdl:update-atmospheric-light', async (_event, war3Path:string, enabled:boolean) => {
        if(typeof enabled!=='boolean')throw new Error('Invalid atmospheric light setting');
        war3Path ||= configManager.get('war3Path');
        if(!war3Path)throw new Error('未设置魔兽争霸III路径');
        if(getChannelModEnabled(getSelectedGameChannel()))await syncAtmosphericLight(await resolveRetailDir(war3Path),
            path.join(await AssetSyncService.getAssetsDir([]),'quenching'),enabled);
        configManager.set('modSettings',{...configManager.get('modSettings'),atmosphericLight:enabled});
        return true;
    });
    ipcMain.handle('mdl:update-lighting-angle', async (_event, war3Path: string, angle: number) => {
        validateUnitLightAngle(angle);
        war3Path ||= configManager.get('war3Path');
        if (!war3Path) throw new Error('未设置魔兽争霸III路径');
        const settings=configManager.get('modSettings') || {};
        const save=()=>configManager.set('modSettings', {...configManager.get('modSettings'), lightingAngle: angle});
        if (!getChannelModEnabled(getSelectedGameChannel())) {save();return true;}
        const profile=await resolveModProfile(war3Path,settings);
        if(profile.graphics==='sd')throw new Error('经典画质不支持光照角度');
        assertShaderProfileSupported(profile);
        const dncDir=path.join(await resolveRetailDir(war3Path),'environment/dnc');
        const q=path.join(await AssetSyncService.getAssetsDir(['dnc','skin']),'quenching');
        await withResourceDirectory(dncDir,()=>patchRotatingUnitLighting(dncDir,getDncResourcePath(q,profile),
            settings.rotatingLighting===true,effectiveLightingMode(profile,settings.lighting || 'standard'),
            settings.lightingBrightness,{deMode:profile.graphics==='de',isVersion30:isVersion30OrLater(profile.version),unitLightAngle:angle},save,true));
        return true;
    });
    ipcMain.handle('mdl:update-rotating-lighting', async (_event, war3Path: string, enabled: boolean) => {
        if (typeof enabled !== 'boolean') throw new Error('Invalid rotating lighting setting');
        war3Path ||= configManager.get('war3Path');
        if (!war3Path) throw new Error('未设置魔兽争霸III路径');
        const savePreference = () => configManager.set('modSettings', {
            ...configManager.get('modSettings'), rotatingLighting: enabled,
        });
        if (!getChannelModEnabled(getSelectedGameChannel())) {
            savePreference();
            return true;
        }
        const settings = configManager.get('modSettings') || {};
        const lighting = settings.lighting || 'standard';
        const profile = await resolveModProfile(war3Path, { ...settings, lighting });
        if (profile.graphics === 'sd') throw new Error('经典画质不支持旋转光照');
        assertShaderProfileSupported(profile);
        const dncDir = path.join(await resolveRetailDir(war3Path), 'environment', 'dnc');
        const quenchingDir = path.join(await AssetSyncService.getAssetsDir(["dnc","skin"]), 'quenching');
        // This operation never syncs shaders, terrain, foliage or other resources.
        await withResourceDirectory(dncDir, () => patchRotatingUnitLighting(dncDir,
            getDncResourcePath(quenchingDir, profile), enabled, effectiveLightingMode(profile, lighting),
            settings.lightingBrightness, { deMode: profile.graphics === 'de', isVersion30: isVersion30OrLater(profile.version), unitLightAngle: settings.lightingAngle },
            savePreference));
        return true;
    });
    /**
     * 更新光照设置
     * @param lightingMode 'standard' | 'enhanced' | 'battle' | 'rpg'
     */
    ipcMain.handle(
        'mdl:update-lighting',
        async (
            event,
            war3Path: string,
            lightingMode: string,
            lightingBrightness?: number,
            _previousLightingMode?: string,
            _previousLightingBrightness?: number,
            requestId?: string,
        ) => {
            const report = createSettingsProgressReporter((step, percent) => {
                if (!event.sender.isDestroyed()) event.sender.send('mod:profile-progress', { step, percent, operation: 'lighting', requestId });
            });
            try {
                report('sync-start', 12);
                if (!war3Path) {
                    war3Path = configManager.get('war3Path');
                }

                if (!war3Path) {
                    throw new Error('未设置魔兽争霸III路径');
                }

                const brightnessLevel = normalizeBrightnessLevel(lightingBrightness);
                console.log(`[MDL] Updating lighting mode: ${lightingMode}, brightness level: ${brightnessLevel}`);

                const modSettings = configManager.get('modSettings') || {};
                const settings = { ...modSettings, lighting: lightingMode, lightingBrightness: brightnessLevel,
                    hdrExposure:lightingMode!==modSettings.lighting?defaultHdrExposure(lightingMode):resolveHdrExposure(modSettings) };
                // Shaders and DNC are selected per lighting mode; DNC is restored
                // from the bundle and patched, so brightness never compounds.
                const assetsDir = await AssetSyncService.getAssetsDir(["dnc","skin"]);
                await syncLightingResources(war3Path, path.join(assetsDir, 'quenching'), settings, undefined, { onProgress: report });
                report('finish', 100);
                return true;
            } catch (error) {
                console.error('Failed to update MDL lighting:', error);
                throw error;
            }
        }
    );
}
