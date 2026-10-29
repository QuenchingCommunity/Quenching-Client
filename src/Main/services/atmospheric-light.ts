import fs from 'fs-extra';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { withResourceDirectory } from './resource-directory-queue';

const section = /(^\[TerrainZFog\][^\r\n]*\r?\n)([\s\S]*?)(?=^\[|$(?![\s\S]))/mi;
export function patchAtmosphericLight(text:string, values:Record<string,string>):string {
  const eol=text.includes('\r\n')?'\r\n':'\n';
  if(!section.test(text))text+=`${eol}[TerrainZFog]${eol}`;
  return text.replace(section,(_all,header,body)=>{
    for(const [key,value] of Object.entries(values)){
      const line=new RegExp(`^${key}=[^\\r\\n]*`,'mi');
      body=line.test(body)?body.replace(line,`${key}=${value}`):body+`${!body||body.endsWith('\n')?'':eol}${key}=${value}${eol}`;
    }
    return header+body;
  });
}
const defaults={Start:'3000',End:'5000',Density:'0.8',MaxLinearDensity:'0.8',Color:'255,0,0,0'};
export async function syncAtmosphericLight(buildDir:string,quenching:string,enabled:boolean):Promise<void>{
  return withResourceDirectory(path.join(buildDir,'ui'),async()=>{
    const file=path.join(buildDir,'ui/MiscData.txt'),backup=path.join(buildDir,'.quenching-atmospheric-light.json');
    const existing=await fs.readFile(file,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(!enabled){
      // Closing atmospheric light removes the complete local override.
      if(existing!==null){
        await fs.copyFile(file,path.join(buildDir,'.quenching-atmospheric-light-disabled.txt'),fs.constants.COPYFILE_EXCL)
          .catch(e=>{if(e.code!=='EEXIST')throw e;});
        await fs.unlink(file);
      }
      await fs.remove(backup);
      return;
    }
    const template=await fs.readFile(path.join(quenching,'ui-misc.txt'),'utf8');
    const text=existing??template;
    const values=Object.fromEntries(Object.keys(defaults).map(key=>[key,template.match(section)?.[2].match(new RegExp(`^${key}=([^\\r\\n]*)`,'mi'))?.[1]??defaults[key as keyof typeof defaults]]));
    const next=patchAtmosphericLight(text,values);
    if(next!==existing){
      await fs.ensureDir(path.dirname(file));const temporary=file+'.'+randomUUID()+'.tmp';
      try{await fs.writeFile(temporary,next,'utf8');await fs.rename(temporary,file);}finally{await fs.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
    }
  });
}
