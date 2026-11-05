const fs=require('fs/promises'),path=require('path'),{execFile}=require('child_process'),{promisify}=require('util');
module.exports=async context=>{
 if(context.electronPlatformName!=='win32')return;
 try{
  const {signingConfigured}=await import('./windows-signing.mjs');
  if(!signingConfigured(context.packager.platformSpecificBuildOptions))return;
  // A pwsh parent can export its PS7-only module paths to Windows PowerShell 5.
  const env={...process.env};delete env.PSModulePath;
  const result=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(__dirname,'check-windows-signatures.ps1'),'-Root',context.appOutDir],{env,windowsHide:true,maxBuffer:1024*1024});
  const records=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
  const invalid=records.filter(r=>r.status!=='Valid'||!r.timestamp);
  if(invalid.length)throw new Error('Windows trusted signing audit failed: '+invalid.map(r=>`${r.path}: ${r.status}${r.timestamp?'':' / no timestamp'}`).join('; '));
  const {checkClientPackage}=await import('./check-client-package.mjs');
  await checkClientPackage(context.appOutDir,{loadNativeModules:false});
  const task=path.join(context.packager.info.projectDir,'_tmp/windows-signing');await fs.mkdir(task,{recursive:true});
  await fs.writeFile(path.join(task,'signature-report.json'),JSON.stringify({passed:true,files:records},null,2));
  console.log('[WindowsTrust] Authenticode trust, timestamps and ASAR integrity verified for '+records.length+' PE files.');
 }finally{require('./windows-native-signing.cjs').restore(context.packager);}
};
