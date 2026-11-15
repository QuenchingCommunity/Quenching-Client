import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const parent=path.resolve('_tmp/hdr-exposure-20261106');await fs.ensureDir(parent);
const root=await fs.mkdtemp(path.join(parent,'ipc-'));
const fixture:any={root,assets:path.join(root,'assets'),channel:'retail',enabled:true,parts:[3,0,1,24368],settings:{lighting:'standard',hdr:true,hdrExposure:1.2,graphicsSelection:'de',versionSelection:'v301',postProcessingGlow:false},handlers:new Map()};
(globalThis as any).__hdrExposureFixture=fixture;
try{
  const result=await build({stdin:{contents:'export {registerShaderHandlers} from "./src/Main/ipc/shader-handlers"; export {AssetSyncService} from "./src/Main/services/asset-sync"; export {GameLauncher} from "./src/Main/services/game-launcher";',resolveDir:process.cwd(),loader:'ts'},
    bundle:true,write:false,format:'cjs',platform:'node',packages:'external',plugins:[{name:'hdr-ipc',setup(plugin){
      plugin.onResolve({filter:/^original-fs$/},()=>({path:'node:fs',external:true}));
      plugin.onResolve({filter:/^electron$|\/(?:config-manager|game-channel|war3-version|full-package-service|ui-service)$/},args=>args.path.endsWith('shared/game-channel')?undefined:{path:args.path,namespace:'fixture'});
      plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:'const f=globalThis.__hdrExposureFixture;'+(
        args.path==='electron'?`export const app={getAppPath:()=>process.cwd(),getVersion:()=>"3.7.0",getPath:()=>f.root};export const ipcMain={handle:(name,handler)=>f.handlers.set(name,handler)};export const nativeImage={};`:
        args.path.endsWith('config-manager')?`export const configManager={get:key=>key==='gameChannel'?f.channel:key==='modSettings'?f.settings:undefined,set:(key,value)=>{if(key==='modSettings')f.settings=value;}};`:
        args.path.endsWith('game-channel')?`export const getSelectedGameChannel=()=>f.channel;export const getSelectedGameFolder=()=>f.channel==='ptr'?'_ptr_':'_retail_';export const getChannelModEnabled=()=>f.enabled;export const hasGameChannelDirectory=async()=>true;`:
        args.path.endsWith('full-package-service')?`export const isFullPackageInstalled=async()=>true,assertFullPackageInstalled=async()=>{},assertTreeModeAvailable=async()=>{};export const resolveRetailDir=async root=>root+'/'+(f.channel==='ptr'?'_ptr_':'_retail_');`:
        args.path.endsWith('ui-service')?`export const UIService={syncConfiguredUI:async()=>{}};`:
        `export const detectWar3Version=async()=>({parts:f.parts,version:f.parts.join('.'),source:'fixture'});export const readShaderPackMarker=async()=>f.parts[0]===2?'shaders203':'';export const resolveUiZipName=async()=>'';export const isShaderPackCurrent=async()=>true;export const normalizeShaderExtractLayout=async()=>{};export const resolveShaderZipName=async()=>'';export const writeShaderPackMarker=async()=>{};`
      )}));
    }}]});
  const loaded={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports);
  loaded.exports.AssetSyncService.getAssetsDir=async()=>fixture.assets;
  loaded.exports.registerShaderHandlers();const change=fixture.handlers.get('shader:update-hdr-exposure');assert(change);
  const config='[ASSAO]\r\nEnabled=1\r\nRadius=77\r\n[Tonemap]\r\nEnabled=1\r\nExposure=1.2\r\n[Bloom]\r\nEnabled=0\r\n';
  await fs.outputFile(path.join(fixture.assets,'quenching/PostProcessingConfig.txt'),config);
  for(const channel of ['retail','ptr']){
    fixture.channel=channel;const branch=path.join(root,channel==='ptr'?'_ptr_':'_retail_'),file=path.join(branch,'PostProcessingConfig.txt');
    const legacy = '\uFEFF[ASSAO]\nRadius=999\n[Tonemap]\nEnabled=1\nExposure=0\n[Tonemap]\nExposure=0\n';
    await fs.outputFile(file,legacy);await fs.outputFile(path.join(branch,'shaders/ps/tonemap.bls'),'unchanged shader');
    await change({},root,2.4);assert.equal(fixture.settings.hdrExposure,2.4);assert.equal(await fs.readFile(file,'utf8'),config.replace('Exposure=1.2','Exposure=2.4'));
    const backup = path.join(branch,'.quenching','PostProcessingConfig.before-template.txt');
    assert.equal(await fs.readFile(backup,'utf8'),legacy);
    fixture.settings.hdr=false;await change({},root,0.75);assert.match(await fs.readFile(file,'utf8'),/\[Tonemap\]\r\nEnabled=0\r\nExposure=0.75/);
    const before=await fs.readFile(file,'utf8');for(const value of [0,0.74,2.41,NaN,'1.2'])await assert.rejects(change({},root,value),/Invalid overall brightness/);
    assert.equal(await fs.readFile(backup,'utf8'),legacy);
    fixture.enabled=false;await change({},root,1.8);assert.equal(fixture.settings.hdrExposure,1.8);assert.equal(await fs.readFile(file,'utf8'),before);
    fixture.enabled=true;fixture.settings.hdr=true;assert.equal(await fs.readFile(path.join(branch,'shaders/ps/tonemap.bls'),'utf8'),'unchanged shader');
  }
  fixture.channel = 'retail';
  fixture.parts = [2, 0, 4, 23745];
  const legacyBranch = path.join(root, '_retail_');
  const staleShader = path.join(legacyBranch, 'shaders/ps/tonemap.bls');
  const legacyConfig = path.join(legacyBranch, 'PostProcessingConfig.txt');
  await fs.outputFile(legacyConfig, config);
  await assert.rejects(fixture.handlers.get('shader:update-hdr')({}, root, true), /HDR tone mapping is unavailable/);
  await assert.rejects(change({}, root, 1.2), /Overall brightness is unavailable/);
  await assert.rejects(fixture.handlers.get('shader:update-post-processing-outline')({}, root, true), /3\.0\.1/);
  await assert.rejects(fixture.handlers.get('shader:update-readability')({}, root, true), /3\.0\.1/);
  await loaded.exports.GameLauncher.prepareLaunchAssets(root);
  assert.equal(await fs.pathExists(legacyConfig), false);
  assert.equal(await fs.pathExists(staleShader), false);
  await loaded.exports.GameLauncher.prepareLaunchAssets(root);
  assert.equal(await fs.pathExists(legacyConfig), false, '2.04 launch does not recreate the config');
  fixture.settings.graphicsSelection = 'sd';
  await fs.outputFile(legacyConfig, config);
  await loaded.exports.AssetSyncService.ensurePostProcessingConfig(root);
  assert.equal(await fs.pathExists(legacyConfig), false, '2.04 SD also removes a loose config');
  assert.equal(await fs.readFile(path.join(root, '_ptr_/shaders/ps/tonemap.bls'), 'utf8'), 'unchanged shader');
  assert.match(await fs.readFile(path.join(root, '_ptr_/PostProcessingConfig.txt'), 'utf8'), /\[Tonemap\]/);
  console.log('PASS: brightness IPC, template repair, Retail/PTR and MOD-off isolation, 2.04 IPC gates and prelaunch cleanup with a current shader marker.');
}finally{delete (globalThis as any).__hdrExposureFixture;assert.equal(path.dirname(root),parent);await fs.remove(root);}
