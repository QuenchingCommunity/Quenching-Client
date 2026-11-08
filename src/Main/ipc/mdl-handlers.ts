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
import {resolveUnitLightSettings,unitLightModeDefaults,validateUnitShadowSetting,type UnitShadowSetting} from '../../shared/unit-light-settings';
import {assertVisionSettingAllowed} from '../services/vision-modules';
import { syncAtmosphericLight } from '../services/atmospheric-light';

async function updateUnitDirection(war3Path:string,changes:{lightingAngle?:number|null;shadowLength?:UnitShadowSetting}){
    war3Path ||= configManager.get('war3Path');
    if(!war3Path)throw new Error('未设置魔兽争霸III路径');
    await assertVisionSettingAllowed(war3Path,changes.shadowLength!==undefined?'shadowLength':'lightingAngle');
    if(configManager.get('modSettings')?.rotatingLighting===true)throw new Error('旋转光照使用固定的40%阴影长度和45°光照角度');
    const settings={...(configManager.get('modSettings')||{}),...changes};
    const save=()=>configManager.set('modSettings',{...configManager.get('modSettings'),...changes});
    if(!getChannelModEnabled(getSelectedGameChannel())){save();return true;}
    const profile=await resolveModProfile(war3Path,settings);
    if(profile.graphics==='sd')throw new Error('经典画质不支持单位光照方向设置');
    assertShaderProfileSupported(profile);
    const dncDir=path.join(await resolveRetailDir(war3Path),'environment/dnc');
    const q=path.join(await AssetSyncService.getAssetsDir(['dnc']),'quenching');
    await withResourceDirectory(dncDir,()=>{
        if(configManager.get('modSettings')?.rotatingLighting===true)throw new Error('旋转光照已开启，单位光照方向控件已锁定');
        // Another queued unit control may have committed while assets loaded.
        const current={...(configManager.get('modSettings')||{}),...changes};
        return patchRotatingUnitLighting(dncDir,getDncResourcePath(q,profile),
            current.rotatingLighting===true,effectiveLightingMode(profile,current.lighting||'standard'),current.lightingBrightness,
            {deMode:profile.graphics==='de',isVersion30:isVersion30OrLater(profile.version),...resolveUnitLightSettings(current)},save,true);
    });
    return true;
}

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
    ipcMain.handle('mdl:update-lighting-angle', async (_event, war3Path: string, angle: number|null) => {
        if(angle!==null)validateUnitLightAngle(angle);
        return updateUnitDirection(war3Path,{lightingAngle:angle});
    });
    ipcMain.handle('mdl:update-shadow-length',async(_event,war3Path:string,value:unknown)=>{
        return updateUnitDirection(war3Path,{shadowLength:validateUnitShadowSetting(value)});
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
            settings.lightingBrightness, { deMode: profile.graphics === 'de', isVersion30: isVersion30OrLater(profile.version), ...resolveUnitLightSettings({...settings,rotatingLighting:enabled}) },
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
                const modeDefaults=unitLightModeDefaults(lightingMode!==modSettings.lighting?{lighting:lightingMode}:{ });
                const settings = { ...modSettings, ...modeDefaults, lighting: lightingMode, lightingBrightness: brightnessLevel,
                    hdrExposure:lightingMode!==modSettings.lighting?defaultHdrExposure(lightingMode):resolveHdrExposure(modSettings) };
                // Shaders and DNC are selected per lighting mode; DNC is restored
                // from the bundle and patched, so brightness never compounds.
                const assetsDir = await AssetSyncService.getAssetsDir(["dnc","skin"]);
                await syncLightingResources(war3Path, path.join(assetsDir, 'quenching'), settings, undefined, { onProgress: report });
                if(modeDefaults.atmosphericLight!==undefined){
                    await syncAtmosphericLight(await resolveRetailDir(war3Path),path.join(assetsDir,'quenching'),modeDefaults.atmosphericLight);
                }
                configManager.set('modSettings',{...configManager.get('modSettings'),...modeDefaults,
                    lighting:lightingMode,lightingBrightness:brightnessLevel,hdrExposure:settings.hdrExposure});
                report('finish', 100);
                return true;
            } catch (error) {
                console.error('Failed to update MDL lighting:', error);
                throw error;
            }
        }
    );
}
