import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import {run7z} from './portable-7z.mjs';

/** Standard DEFLATE ZIP, readable by Explorer. Mac signed apps use native ditto. */
export async function createPortableZip(source,output,rootName){
  source=path.resolve(source);output=path.resolve(output);
  if(!/^[^\\/:\x00-\x1f]+$/.test(rootName)||['.','..'].includes(rootName))throw Error('Invalid archive root');
  if(path.extname(output).toLowerCase()!=='.zip')throw Error('Portable output must end in .zip');
  if(await fs.lstat(output).catch(e=>{if(e.code!=='ENOENT')throw e;return null;}))throw Error('Output already exists');
  async function verify(dir){
    const info=await fs.lstat(dir);if(info.isSymbolicLink())throw Error('Portable ZIP source must not contain links');
    if(!info.isDirectory())throw Error('Expected a portable client directory');
    for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('Portable ZIP source must not contain links');if(entry.isDirectory())await verify(path.join(dir,entry.name));}
  }
  await verify(source);
  const parent=path.resolve('_tmp/client-portable-zip');await fs.mkdir(parent,{recursive:true});
  const task=await fs.mkdtemp(path.join(parent,'export-')),staged=path.join(task,'portable.zip');
  try{
    await new Promise((resolve,reject)=>{
      const outputStream=createWriteStream(staged,{flags:'wx'}),archive=archiver('zip',{zlib:{level:6}});
      outputStream.once('close',resolve);outputStream.once('error',reject);
      archive.once('error',reject);archive.once('warning',reject);archive.pipe(outputStream);
      archive.directory(source,rootName);archive.finalize().catch(reject);
    });
    await run7z(['t','-bso0','-bsp0',staged]);
    let listing='';await run7z(['l','-slt','-ba','-sccUTF-8',staged],{onData:bytes=>{listing+=bytes;}});
    const entries=[...listing.matchAll(/^Path = (.+)\r?$/gm)].map(m=>m[1].replaceAll('\\','/').trim());
    await fs.mkdir(path.dirname(output),{recursive:true});await fs.rename(staged,output);
    return entries;
  }finally{await fs.unlink(staged).catch(e=>{if(e.code!=='ENOENT')throw e;});await fs.rmdir(task);}
}
