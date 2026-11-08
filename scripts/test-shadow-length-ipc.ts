import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'fs-extra';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {unitRotationBlock,replaceUnitRotation} from '../src/Main/services/rotating-lighting';
import {lightDirection} from '../src/shared/dnc-rotation';
import {renderDncLighting} from '../src/Main/services/dnc-lighting';
import {resolveUnitLightSettings} from '../src/shared/unit-light-settings';
const parent=path.resolve('_tmp/shadow-default50-20261108');await fs.ensureDir(parent);const root=await fs.mkdtemp(path.join(parent,'ipc-'));
const f:any={root,assets:path.join(root,'assets'),baseline:path.resolve('assets/unpacked/dnc/dnc30-hd'),channel:'retail',enabled:true,owned:false,failCommit:false,
 settings:{lighting:'standard',shadowLength:'long',lightingAngle:230,lightingBrightness:3,graphicsSelection:'hd'},profile:{graphics:'hd',version:'v301'},handlers:new Map()};
(globalThis as any).__shadowFixture=f;
const snapshot=async(dir:string)=>{const out=new Map<string,string>();for(const n of await fs.readdir(dir,{recursive:true})){const p=path.join(dir,n);if((await fs.lstat(p)).isFile())out.set(String(n).replaceAll('\\','/'),await fs.readFile(p,'utf8'));}return out;};
try{
 const result=await build({stdin:{contents:'export {registerMdlHandlers} from "./src/Main/ipc/mdl-handlers";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'shadow-ipc',setup(b){
  b.onResolve({filter:/^electron$|\/(config-manager|game-channel|full-package-service|mod-profile|asset-sync|vision-modules)$/},args=>args.path.includes('/shared/')?undefined:{path:args.path,namespace:'fixture'});
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:'const f=globalThis.__shadowFixture;'+(
   args.path==='electron'?`export const ipcMain={handle:(key,fn)=>f.handlers.set(key,fn)};`:
   args.path.endsWith('config-manager')?`export const configManager={get:key=>key==='modSettings'?f.settings:key==='war3Path'?f.root:undefined,set:(_key,value)=>{if(f.failCommit)throw Error('commit failed');f.settings=value;}};`:
   args.path.endsWith('game-channel')?`export const getChannelModEnabled=()=>f.enabled;export const getSelectedGameChannel=()=>f.channel;export const getSelectedGameFolder=()=>f.channel==='ptr'?'_ptr_':'_retail_';`:
   args.path.endsWith('full-package-service')?`export const resolveRetailDir=async root=>require('path').join(root,f.channel==='ptr'?'_ptr_':'_retail_');`:
   args.path.endsWith('asset-sync')?`export const AssetSyncService={getAssetsDir:async()=>f.assets};export const syncLightingResources=async()=>{throw Error('length-only change must not sync resources');};`:
   args.path.endsWith('vision-modules')?`export const assertVisionSettingAllowed=async()=>{if(f.owned)throw Error('Vision owns shaders');};`:
   `export const resolveModProfile=async()=>f.profile;export const getDncResourcePath=()=>f.baseline;export const effectiveLightingMode=(_p,mode)=>mode;`
  ),resolveDir:process.cwd()}));
 }}]});
 const loaded={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports);loaded.exports.registerMdlHandlers();
 const change=f.handlers.get('mdl:update-shadow-length'),angle=f.handlers.get('mdl:update-lighting-angle');assert(change&&angle);
 for(const channel of ['retail','ptr']){
  f.settings={...f.settings,lightingAngle:230,shadowLength:'long'};
  f.channel=channel;const branch=path.join(root,channel==='ptr'?'_ptr_':'_retail_'),dnc=path.join(branch,'environment/dnc');await fs.copy(f.baseline,dnc);
  await fs.outputFile(path.join(branch,'shaders/ps/keep.bls'),'shader untouched');await fs.outputFile(path.join(branch,'NELonstar/keep.txt'),'player folder');
  const before=await snapshot(branch);await change({},root,'short');assert.equal(f.settings.shadowLength,'short');assert.equal(f.settings.lightingAngle,230);
  for(const [name,content]of before){const actual=await fs.readFile(path.join(branch,name),'utf8');if(/unit[^/]*\.mdl$/i.test(name)&&!/terrain|portrait/i.test(name)){
   assert.equal(replaceUnitRotation(actual,'R'),replaceUnitRotation(content,'R'));const key=unitRotationBlock(actual).match(/\d+:\s*\{\s*([^}]+)\}/)!;const d=lightDirection(key[1].split(',').map(Number));assert(Math.abs(Math.asin(d[2])*180/Math.PI-80)<1e-8);
  }else assert.equal(actual,content,name);}
  const stable=await snapshot(branch);f.failCommit=true;await assert.rejects(change({},root,'long'),/commit failed/);f.failCommit=false;assert.deepEqual(await snapshot(branch),stable);assert.equal(f.settings.shadowLength,'short');
  f.owned=true;await assert.rejects(change({},root,'long'),/Vision/);f.owned=false;assert.deepEqual(await snapshot(branch),stable);
  for(const bad of ['medium',false,-1,101,NaN,Infinity,'50',null])await assert.rejects(change({},root,bad),/Invalid unit shadow length/);
  f.enabled=false;await change({},root,'long');assert.equal(f.settings.shadowLength,'long');assert.deepEqual(await snapshot(branch),stable,'MOD-off preference does not write files');f.enabled=true;
  await change({},root,'long');await angle({},root,90);assert.equal(f.settings.lightingAngle,90);assert.equal(f.settings.shadowLength,'long');
  await Promise.all([angle({},root,230),change({},root,'short')]);
  assert.equal(f.settings.lightingAngle,230);assert.equal(f.settings.shadowLength,'short');
  const unit=await fs.readFile(path.join(dnc,'dnclordaeron/dnclordaeronunit/dnclordaeronunit.mdl'),'utf8');
  const key=unitRotationBlock(unit).match(/\d+:\s*\{\s*([^}]+)\}/)!;const dir=lightDirection(key[1].split(',').map(Number));
  assert(Math.abs(Math.asin(dir[2])*180/Math.PI-80)<1e-8);
  assert(Math.abs(Math.atan2(Math.sin(Math.atan2(dir[1],dir[0])-230*Math.PI/180),Math.cos(Math.atan2(dir[1],dir[0])-230*Math.PI/180)))<1e-8,'queued angle/length remain consistent with saved settings');
  const relative='dnclordaeron/dnclordaeronunit/dnclordaeronunit.mdl';
  const source=await fs.readFile(path.join(f.baseline,relative),'utf8');
  const rotation=async()=>unitRotationBlock(await fs.readFile(path.join(dnc,relative),'utf8')).replaceAll('\r\n','\n');
  const expected=()=>unitRotationBlock(renderDncLighting(source,relative,'battle',3,{isVersion30:true,...resolveUnitLightSettings(f.settings)})).replaceAll('\r\n','\n');
  const rotate=f.handlers.get('mdl:update-rotating-lighting');
  const beforeRotate=await snapshot(branch),savedBefore={...f.settings};
  await rotate({},root,true);
  assert.equal(f.settings.shadowLength,savedBefore.shadowLength);assert.equal(f.settings.lightingAngle,savedBefore.lightingAngle);
  await assert.rejects(change({},root,20),/旋转光照/);
  await rotate({},root,false);
  assert.deepEqual(await snapshot(branch),beforeRotate,'turning rotation off restores saved unit orientation without terrain changes');
  f.settings={...f.settings,lighting:'battle'};
  await angle({},root,null);assert.equal(f.settings.lightingAngle,null);assert.equal(f.settings.shadowLength,'short');assert.equal(await rotation(),expected());
  const resetAngle=await snapshot(branch);f.failCommit=true;await assert.rejects(change({},root,'default'),/commit failed/);f.failCommit=false;assert.deepEqual(await snapshot(branch),resetAngle,'reset failure rolls back');
  await change({},root,'default');assert.equal(f.settings.shadowLength,'default');assert.equal(f.settings.lightingAngle,null);
  assert.equal(await rotation(),unitRotationBlock(source).replaceAll('\r\n','\n'),'both controls reset to the raw original DNC');
  for(const position of [0,25,50,75,100]){
   await change({},root,position);assert.equal(f.settings.shadowLength,position);assert.equal(f.settings.lightingAngle,null);
   const value=(await rotation()).match(/\d+:\s*\{\s*([^}]+)\}/)![1].split(',').map(Number);
   const nativeValue=unitRotationBlock(source).match(/\d+:\s*\{\s*([^}]+)\}/)![1].split(',').map(Number);
   const native=Math.asin(lightDirection(nativeValue)[2])*180/Math.PI;
   const expected=position<=50?80+(native-80)*position/50:native+(15-native)*(position-50)/50;
   assert(Math.abs(Math.asin(lightDirection(value)[2])*180/Math.PI-expected)<1e-8,'continuous length is anchored on the raw DNC at 50%');
   if(position===50)assert.equal(await rotation(),unitRotationBlock(source).replaceAll('\r\n','\n'),'50% restores raw DNC bytes');
  }
  await change({},root,'default');
  await angle({},root,90);assert.equal(f.settings.shadowLength,'default');assert.equal(await rotation(),expected());
  await angle({},root,null);f.enabled=false;const resetStable=await snapshot(branch);await change({},root,'long');await change({},root,'default');assert.deepEqual(await snapshot(branch),resetStable);f.enabled=true;
 }
 f.settings.rotatingLighting=true;await assert.rejects(change({},root,90),/旋转光照/);await assert.rejects(angle({},root,100),/旋转光照/);f.settings.rotatingLighting=false;
 f.profile={graphics:'sd',version:'v301'};await assert.rejects(change({},root,'short'),/经典画质/);
 console.log('PASS: actual shadow IPC, Retail/PTR unit-only rotations, angle independence, terrain/shader/custom preservation, commit rollback, invalid inputs, MOD-off and Vision/SD gates');
}finally{delete (globalThis as any).__shadowFixture;assert.equal(path.dirname(root),parent);await fs.remove(root);}
