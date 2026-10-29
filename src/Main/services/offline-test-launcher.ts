import { app, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'fs-extra';
import { randomUUID } from 'node:crypto';
import { Storage } from '@jamiephan/casclib';
import { openGameCascStorage } from './casc-storage';
import { configManager } from './config-manager';
import { normalizeWar3RootPath } from './war3-path';
import { getSelectedGameChannel } from './game-channel';
import { resolveModProfile } from './mod-profile';
import { assertShaderProfileSupported } from '../../shared/mod-profile';
import { detectWar3Version } from './war3-version';
import { GameLauncher } from './game-launcher';
import { IS_TEST_RELEASE } from '../../shared/local-release';

export const STARTER_MAP_CASC = 'war3.w3mod:maps\\(2)a_starter_map_losttemple_lv.w3x';
let launching=false;

export async function launchOfflineStarterMap():Promise<boolean>{
  if(!IS_TEST_RELEASE)throw new Error('离线地图测试仅供测试版使用');
  if(process.platform!=='win32')throw new Error('离线地图测试仅支持 Windows');
  if(getSelectedGameChannel()!=='retail')throw new Error('当前 offline.exe 仅支持 Retail，请先切换游戏分支');
  if(launching)throw new Error('正在准备离线地图测试');
  launching=true;
  try{
    const saved=configManager.get('war3Path');if(!saved)throw new Error('请先选择魔兽根目录');
    const root=normalizeWar3RootPath(saved),exe=path.join(root,'offline.exe');
    const stat=await fs.lstat(exe).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(!stat?.isFile()||stat.isSymbolicLink())throw new Error('魔兽根目录缺少 offline.exe，请自行放置后重试');
    const version=await detectWar3Version(root);
    if(version.parts.slice(0,3).join('.')!=='3.0.1')throw new Error('当前 offline.exe 仅支持魔兽 3.0.1');
    const profile=await resolveModProfile(root,configManager.get('modSettings')||{});
    assertShaderProfileSupported(profile);
    const storage=new Storage();let release:(()=>void)|undefined;let bytes:Buffer;
    try{
      release=(await openGameCascStorage(storage,root)).release;
      const file=storage.openFile(STARTER_MAP_CASC);
      try{bytes=file.readAll();}finally{file.close();}
    }catch(error){throw new Error(`无法从 CASC 读取 Starter Map Lost Temple：${error instanceof Error?error.message:String(error)}`);}
    finally{try{storage.close();}catch{}release?.();}
    if(!bytes!.length)throw new Error('Starter Map Lost Temple 内容为空');
    const directory=path.join(app.getPath('userData'),'offline-test');await fs.ensureDir(directory);
    const map=path.join(directory,'(2)a_starter_map_losttemple_lv.w3x');
    const temporary=map+'.'+randomUUID()+'.tmp';
    try{await fs.writeFile(temporary,bytes!);await fs.rename(temporary,map);}finally{await fs.remove(temporary);}
    await GameLauncher.prepareLaunchAssets(root);
    const graphics=profile.graphics==='sd'?'1':profile.graphics==='de'?'3':'2';
    await new Promise<void>((resolve,reject)=>{
      const child=spawn(exe,[map,'--hd',graphics],{cwd:root,detached:true,stdio:'ignore',windowsHide:true,shell:false});
      child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
    });
    return true;
  }finally{launching=false;}
}

export function registerOfflineTestLauncher():void{
  if(IS_TEST_RELEASE)ipcMain.handle('game:launch-offline-starter',()=>launchOfflineStarterMap());
}
