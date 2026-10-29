import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export async function run7z(args, { cwd, onData } = {}) {
  return new Promise((resolve, reject) => {
    const child=spawn(require('7zip-bin-full').path7z,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let tail='';
    child.stdout.on('data', chunk=>{ if(onData) onData(chunk); else tail=(tail+chunk).slice(-3000); });
    child.stderr.on('data', chunk=>{tail=(tail+chunk).slice(-3000);});
    child.once('error',reject);
    child.once('close',code=>code===0?resolve(tail):reject(new Error(`7z failed (${code}): ${tail}`)));
  });
}

/** Solid outer portable archive; inner resources.7z stays selective and unchanged. */
export async function createPortable7z(source, output, rootName) {
  source=path.resolve(source); output=path.resolve(output);
  if(!/^[^\\/:\x00-\x1f]+$/.test(rootName) || ['.','..'].includes(rootName)) throw new Error('Invalid archive root');
  if(path.extname(output).toLowerCase()!=='.7z') throw new Error('Portable output must end in .7z');
  if(await fs.stat(output).catch(()=>null)) throw new Error('Output already exists');
  const parent=path.resolve('_tmp/client-portable-7z'); await fs.mkdir(parent,{recursive:true});
  const task=await fs.mkdtemp(path.join(parent,'export-'));
  const archive=path.join(task,'portable.7z');
  let last=-10;
  try {
    console.log('[Portable] Compressing 7z');
    await run7z(['a','-t7z','-mx=7','-m0=LZMA2','-md=64m','-mmt=2','-ms=on','-bso0','-bsp1',archive,path.basename(source)],
      {cwd:path.dirname(source),onData:chunk=>{for(const match of String(chunk).matchAll(/(\d+)%/g)){
        const percent=Number(match[1]); if(percent>=last+10){last=percent;console.log(`[Portable] ${percent}%`);}
      }}});
    if(path.basename(source)!==rootName) await run7z(['rn',archive,path.basename(source),rootName,'-bso0','-bsp0']);
    await run7z(['t',archive,'-bso0','-bsp0']);
    let listing='';
    await run7z(['l','-slt','-ba','-sccUTF-8',archive],{onData:chunk=>{listing+=chunk;}});
    const entries=[...listing.matchAll(/^Path = (.+)\r?$/gm)].map(m=>m[1].replaceAll('\\','/').trim());
    await fs.mkdir(path.dirname(output),{recursive:true});
    await fs.rename(archive,output);
    return entries;
  } finally {
    await fs.unlink(archive).catch(e=>{if(e.code!=='ENOENT')throw e;});
    await fs.rmdir(task);
  }
}
