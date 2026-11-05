// Sign unpacked PE files before rebuilding their ASAR size/hash records. The
// main EXE is still unsigned here, so its updated ASAR integrity can be embedded.
const fs=require('fs/promises'),path=require('path'),asar=require('@electron/asar');
const states=new WeakMap();
module.exports=async context=>{
 if(context.electronPlatformName!=='win32')return;
 const {signingConfigured}=await import('./windows-signing.mjs');
 if(!signingConfigured(context.packager.platformSpecificBuildOptions))return;
 const packager=context.packager,archive=path.join(context.appOutDir,'resources/app.asar');
 const {unpackedFileRecords}=await import('./check-client-package.mjs');
 const records=unpackedFileRecords(archive),signed=new Set(),original=packager.sign;
 for(const record of records){
  if(!/\.(node|dll|exe)$/i.test(record.path))continue;
  const file=path.resolve(archive+'.unpacked',record.path);
  if(!await original.call(packager,file))throw new Error('Native PE signing did not complete: '+record.path);
  signed.add(file);
 }
 if(!signed.size)return;
 const task=path.join(packager.info.projectDir,'_tmp/windows-signing');await fs.mkdir(task,{recursive:true});
 const work=await fs.mkdtemp(path.join(task,'asar-'));
 try{
  const source=path.join(work,'source'),rebuilt=path.join(work,'app.asar');
  asar.extractAll(archive,source);
  // Preserve exactly which files were unpacked, including non-binary files.
  const patterns=records.map(r=>path.resolve(source,r.path).replaceAll('\\','/'));
  await asar.createPackageWithOptions(source,rebuilt,{unpack:patterns.length===1?patterns[0]:'{'+patterns.join(',')+'}'});
  const refreshed=unpackedFileRecords(rebuilt);
  if(JSON.stringify(refreshed.map(r=>r.path).sort())!==JSON.stringify(records.map(r=>r.path).sort()))throw new Error('Signed ASAR changed unpacked file membership');
  const {checkClientPackage}=await import('./check-client-package.mjs');
  const verifyRoot=path.join(work,'verify');await fs.mkdir(path.join(verifyRoot,'resources'),{recursive:true});
  await fs.rename(rebuilt,path.join(verifyRoot,'resources/app.asar'));
  await fs.rename(rebuilt+'.unpacked',path.join(verifyRoot,'resources/app.asar.unpacked'));
  await checkClientPackage(verifyRoot,{loadNativeModules:false});
  asar.uncache(archive);await fs.copyFile(path.join(verifyRoot,'resources/app.asar'),archive);
  const {computeData}=require('app-builder-lib/out/asar/integrity');
  const {addWinAsarIntegrity}=require('app-builder-lib/out/electron/electronWin');
  await addWinAsarIntegrity(path.join(context.appOutDir,packager.appInfo.productFilename+'.exe'),await computeData({resourcesPath:path.dirname(archive),resourcesRelativePath:'resources'}));
  // electron-builder signs app.asar.unpacked after the main EXE. Do not sign
  // these files twice: timestamp/certificate changes would stale the ASAR again.
  packager.sign=async function(file,...args){return signed.has(path.resolve(file))?true:original.call(this,file,...args);};
  states.set(packager,original);
 }finally{
  if(path.dirname(work)!==task)throw new Error('Signing cleanup boundary mismatch');
  await fs.rm(work,{recursive:true,force:true});
 }
};
module.exports.restore=packager=>{const original=states.get(packager);if(original){packager.sign=original;states.delete(packager);}};
