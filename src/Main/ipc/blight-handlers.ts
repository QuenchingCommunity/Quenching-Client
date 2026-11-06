import {assertVisionSettingAllowed} from '../services/vision-modules';
import { ipcMain } from 'electron';
import { applyBlightSettings } from '../services/blight-service';

export function registerBlightHandlers(): void {
  ipcMain.handle('blight:update-settings', async (_event, war3Path: string, enabled: boolean) => {
    if (!war3Path || typeof enabled !== 'boolean') throw new Error('腐蚀之地设置参数无效');
    await assertVisionSettingAllowed(war3Path,'blight');
    await applyBlightSettings(war3Path, enabled);
    return true;
  });
}
