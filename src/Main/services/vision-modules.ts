import fs from 'fs-extra';
import path from 'node:path';
import {getSelectedGameFolder,getChannelModEnabled} from './game-channel';
import {withResourceDirectory} from './resource-directory-queue';
import {VISION_MODULES, VisionModule, VisionModules, visionModuleFor, visionBlocksSetting} from '../../shared/vision-modules';

interface Entry { files:string[]; replaced:string[]; backup:string; source:string }
type State=Partial<Record<VisionModule,Entry>>;
type BranchFolder = '_retail_' | '_ptr_';
const stateFile=(root:string,folder:BranchFolder=getSelectedGameFolder())=>path.join(root,folder,'.quenching-vision-modules.json');
async function read(root:string,folder:BranchFolder=getSelectedGameFolder()):Promise<State>{
  const state=await fs.readJson(stateFile(root,folder)).catch(e=>{if(e.code==='ENOENT')return {};throw e;});
  for(const [key,entry] of Object.entries(state) as [VisionModule,Entry][]){
    if(!VISION_MODULES.includes(key)||!entry || !/^vision-[\w-]+$/.test(entry.backup)||
      !Array.isArray(entry.files)||!Array.isArray(entry.replaced)||[...entry.files,...entry.replaced].some(n=>!n||n.includes('\\')||n.split('/').some(p=>!p||p==='.'||p==='..'||p.includes(':'))))throw Error('Invalid Vision Mod state');
  }return state;
}
export async function getVisionModules(root:string):Promise<VisionModules>{
  const state=await read(root);return {...Object.fromEntries(VISION_MODULES.map(k=>[k,!!state[k]])),visionMiscUI:!!state.visionMisc?.files.some(n=>/^(ui|webui)\//i.test(n)),visionMiscShaders:!!state.visionMisc?.files.some(n=>/^shaders\//i.test(n))};
}
export async function assertVisionSettingAllowed(root:string,key:string):Promise<void>{
  if(visionBlocksSetting(await getVisionModules(root),key))throw Error('此设置由 Vision Mod 接管，请先关闭对应模块。');
}
async function list(root:string,relative=''):Promise<string[]>{
  const result:string[]=[];
  for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
    if(entry.isSymbolicLink())throw Error('Vision Mod 不支持链接目录或文件');
    const name=relative?relative+'/'+entry.name:entry.name;
    if(entry.isDirectory())result.push(...await list(root,name));else if(entry.isFile())result.push(name);
  }return result;
}
/** Each switch has independent backups; unit TXT tables and COS remain owned by Quenching. */
export async function setVisionModule(root:string,source:string,module:VisionModule,enabled:boolean):Promise<boolean>{
  return setVisionModuleInBranch(root,source,module,enabled,getSelectedGameFolder());
}

/** Restore each module before the MOD switch parks the branch's original files. */
export async function disableVisionModulesForBranch(buildDir:string):Promise<void>{
  const branch=path.resolve(buildDir),folder=path.basename(branch);
  if(folder!=='_retail_'&&folder!=='_ptr_')throw Error('Invalid game branch for Vision Mod restore');
  const root=path.dirname(branch),state=await read(root,folder);
  for(const module of [...VISION_MODULES].reverse())if(state[module]){
    await setVisionModuleInBranch(root,'',module,false,folder);
  }
}

async function setVisionModuleInBranch(root:string,source:string,module:VisionModule,enabled:boolean,folder:BranchFolder):Promise<boolean>{
  if(!VISION_MODULES.includes(module)||typeof enabled!=='boolean')throw Error('Invalid Vision Mod switch');
  const branch=path.join(root,folder);
  return withResourceDirectory(path.join(branch,'vision-switch'),async()=>{
    if(!(await fs.stat(branch)).isDirectory())throw Error('未找到游戏分支');
    const state=await read(root,folder);if(!!state[module]===enabled)return true;
    const tmp=path.join(branch,'_tmp');await fs.ensureDir(tmp);
    if((await fs.lstat(tmp)).isSymbolicLink())throw Error('Vision Mod temporary path cannot be a link');
    const work=await fs.mkdtemp(path.join(tmp,'vision-'));
    const undo:Array<()=>Promise<void>>=[];let preserve=false;
    const move=async(from:string,to:string)=>{
      for(const target of [from,to]){let parent=path.dirname(target);while(parent!==branch && parent.startsWith(branch+path.sep)){const info=await fs.lstat(parent).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(info?.isSymbolicLink())throw Error('Vision Mod parent cannot be a link');parent=path.dirname(parent);}}
      if(!await fs.pathExists(from))return false;
      if(await fs.pathExists(to))throw Error('Vision Mod backup collision');
      if((await fs.lstat(from)).isSymbolicLink())throw Error('Vision Mod target cannot be a link');
      await fs.ensureDir(path.dirname(to));await fs.rename(from,to);
      undo.push(async()=>{await fs.ensureDir(path.dirname(from));await fs.rename(to,from);});return true;
    };
    try{
      if(enabled){
        if(!getChannelModEnabled(folder==='_ptr_'?'ptr':'retail'))throw Error('请先启用当前分支的淬火 MOD');
        const thirdParty=await fs.readJson(path.join(branch,'_QMThirdParty.json')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
        if(thirdParty?.slots?.some((slot:any)=>slot.enabled))throw Error('请先关闭其他第三方资源槽');
        let input=path.resolve(source);
        for(const candidate of [...new Set([folder,'_retail_','_ptr_'])])if(await fs.pathExists(path.join(input,candidate))){input=path.join(input,candidate);break;}
        if(input===path.resolve(branch)||input===path.resolve(root))throw Error('请选择 Vision Mod 资源目录，而不是游戏目录');
        const relative=path.relative(path.resolve(branch),input);
        if(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw Error('不能使用游戏分支内的资源目录');
        if((await fs.lstat(input)).isSymbolicLink())throw Error('Vision Mod source cannot be a link');
        const files=(await list(input)).filter(name=>visionModuleFor(name)===module);
        if(!files.length)throw Error('Vision Mod 目录中没有该模块资源');
        // Stage every selected source before changing any active file.
        for(const name of files)await fs.copy(path.join(input,name),path.join(work,'prepared',name));
        const backup=path.basename(work),saved=path.join(branch,'.quenching-vision-backups',backup);
        const replaced:string[]=[];
        const roots=module==='visionDecorations'?['doodads','replaceabletextures','units/destructableskin.txt']:
          module==='visionTerrain'?['terrainart','terrain','environment/foliage','env/foliage']:
          module==='visionMisc'?[...new Set(files.map(name=>{const parts=name.split('/');return /^(env|environment)$/i.test(parts[0])?parts.slice(0,2).join('/'):parts[0];}))]:[];
        for(const name of roots)if(await move(path.join(branch,name),path.join(saved,name)))replaced.push(name);
        for(const name of files){
          let parent=branch;
          for(const part of name.split('/').slice(0,-1)){parent=path.join(parent,part);await fs.ensureDir(parent);if((await fs.lstat(parent)).isSymbolicLink())throw Error('Vision Mod target parent cannot be a link');}
          if(await move(path.join(branch,name),path.join(saved,name)))replaced.push(name);
          await move(path.join(work,'prepared',name),path.join(branch,name));
        }
        state[module]={files,replaced,backup,source};
      }else{
        const entry=state[module]!;const saved=path.join(branch,'.quenching-vision-backups',entry.backup);
        for(const name of entry.files)await move(path.join(branch,name),path.join(work,'removed',name));
        for(const name of entry.replaced){
          // Clear directories created for third-party files before restoring the original tree.
          if(await fs.pathExists(path.join(branch,name)))await move(path.join(branch,name),path.join(work,'leftover',name));
          if(!await move(path.join(saved,name),path.join(branch,name)))throw Error('Vision Mod 原文件备份缺失：'+name);
        }
        delete state[module];
      }
      const marker=path.join(work,'state.json');await fs.writeJson(marker,state,{spaces:2});await fs.rename(marker,stateFile(root,folder));
    }catch(error){
      for(const rollback of undo.reverse())try{await rollback();}catch{preserve=true;}
      if(preserve)throw new AggregateError([error],`Vision Mod 恢复未完成，备份保留：${work}`);
      throw error;
    }finally{if(!preserve)await fs.remove(work);}
    return true;
  });
}
