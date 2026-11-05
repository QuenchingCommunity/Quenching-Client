import fs from 'node:fs/promises';
import path from 'node:path';
export function signingConfigured(win={},env=process.env){
  const s=win.signtoolOptions||{};
  return !!(env.WIN_CSC_LINK||env.CSC_LINK||win.azureSignOptions||s.sign||win.sign||s.certificateFile||win.certificateFile||s.certificateSha1||win.certificateSha1||s.certificateSubjectName||win.certificateSubjectName);
}
export async function configureWindowsSigning(context){
  const release=JSON.parse(await fs.readFile(path.join(context.packager.info.projectDir,'release-version.json'),'utf8'));
  const config=context.packager.config,win=context.packager.platformSpecificBuildOptions;
  const required=release.channel!=='test'||win.forceCodeSigning===true||config.forceCodeSigning===true;
  if(required){config.forceCodeSigning=true;win.forceCodeSigning=true;}
  if(win.signAndEditExecutable===false)throw new Error('Windows signing requires signAndEditExecutable; keep app integrity and signing enabled.');
  win.signExts=[...new Set([...(win.signExts||[]),'.node','.dll'])];
  if(required&&!signingConfigured(win))throw new Error('正式 Windows 包需要可信 Authenticode 代码签名。请配置 CSC_LINK／WIN_CSC_LINK、win.signtoolOptions 证书或 azureSignOptions；不能把未签名包作为安全修复版本发布。');
  if(!signingConfigured(win))console.warn('[WindowsTrust] TEST 包未配置代码签名，Windows 仍可能拦截 EXE／NODE；此构建不具备可信发布者身份。');
  return {required,configured:signingConfigured(win)};
}
