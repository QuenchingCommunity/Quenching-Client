import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setBuildChannel} from './set-build-channel.mjs';
import {checkProductionBuild} from './check-production-build.mjs';

const platform=process.argv[2];
if(!['win','mac'].includes(platform))throw Error('Usage: node scripts/package-production.mjs win|mac');
if(platform==='mac'&&process.platform!=='darwin')throw Error('Build Mac packages on macOS');
if(platform==='win'&&process.platform!=='win32')throw Error('Build Windows packages on Windows');
const release=await setBuildChannel('production');
const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
const run=(command,args)=>new Promise((resolve,reject)=>{const child=spawn(command,args,{shell:process.platform==='win32'&&command==='npm',windowsHide:true,stdio:'inherit'});child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error(command+' failed: '+code)));});
if(platform==='win'){
  await run('npm',['run','dist:win']);await checkProductionBuild();
  await run(process.execPath,['scripts/export-win-portable.mjs','__Bin/win-unpacked',`__Bin/QMC-${release.displayVersion}-Win-x64.7z`,`QMC-${release.displayVersion}-Win-x64`,'--channel','production']);
}else{await run('npm',['run','dist:mac:app']);await checkProductionBuild();}
console.log(JSON.stringify({channel:'production',version:release.displayVersion,internalVersion:pkg.version,platform,testContentRemoved:true}));
