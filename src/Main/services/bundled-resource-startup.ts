import { ipcMain, type BrowserWindow } from 'electron';
import { ResourceStartupTask } from '../../shared/resource-startup';
import { AssetSyncService } from './asset-sync';
import { acknowledgeClientUpdate } from './client-update-service';
import { startupTelemetry } from './startup-telemetry';
import { scheduleStartupRendering } from './startup-rendering';
import { deferBundledResourcePreparation } from './bundled-assets';

let activeWindow:BrowserWindow|null=null;
let registered=false;
let releasePreparation=()=>{};
let clientReady=false;
const task=new ResourceStartupTask({
  prepare:async notify=>{
    try {await AssetSyncService.prepareStartupAssets(notify,async()=>{
      // The painted client is healthy; derived-cache work must not trip the
      // update helper's startup deadline on a slow first extraction.
      if(clientReady)return;
      await acknowledgeClientUpdate();startupTelemetry.markStartupSuccess();clientReady=true;
    });}finally{releasePreparation();}
  },
  publish:status=>{
    if(status.firstRun && activeWindow && !activeWindow.isDestroyed() && !activeWindow.webContents.isDestroyed()) {
      activeWindow.webContents.send('resources:startup-progress',status);
    }
  },
  complete:async()=>{
    if(activeWindow && !activeWindow.isDestroyed())scheduleStartupRendering(activeWindow);
  },
  failure:error=>{
    console.error('[Resources] Background preparation failed:',error);
    if(!clientReady)startupTelemetry.recordStartupFailure(error);
    if(activeWindow && !activeWindow.isDestroyed() && !activeWindow.webContents.isDestroyed()) {
      activeWindow.webContents.send('mod:startup-rendering-result',{status:'failed',error:error instanceof Error?error.message:String(error)});
    }
  },
});

export function installBundledResourceStartup(window:BrowserWindow):void {
  activeWindow=window;
  window.once('closed',()=>{if(activeWindow===window)activeWindow=null;});
  // Chromium pauses animation frames in hidden automation windows.
  if(process.env.QUENCHING_AUTOMATED_TEST_HEADLESS==='1')window.webContents.once('did-finish-load',()=>task.start());
  if(registered)return;
  registered=true;
  deferBundledResourcePreparation(new Promise<void>(resolve=>{releasePreparation=resolve;}));
  ipcMain.handle('resources:startup-ready',event=>{
    if(!activeWindow || event.sender!==activeWindow.webContents)throw new Error('Invalid resource startup sender');
    return task.start();
  });
}
