import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {build} from 'esbuild';
import {isDistributableAsset} from '../src/shared/bundled-resource-paths.mjs';
const parent=path.resolve('_tmp/offline-test-20261029');await fs.ensureDir(parent);
const root=await fs.mkdtemp(path.join(parent,'test-'));
const f:any={root:path.join(root,'游戏 root & (test)'),data:path.join(root,'user-data'),test:true,channel:'retail',version:[3,0,1,24371],graphics:'hd',events:[],spawn:[]};
await fs.outputFile(path.join(f.root,'offline.exe'),'fake-external-file-never-executed');
(globalThis as any).__offlineFixture=f;
const mocks:Record<string,string>={
 electron:`export const app={getPath:()=>f.data};export const ipcMain={handle:(name,callback)=>f.events.push(name)};`,
 'child_process':`const EventEmitter=require('node:events').EventEmitter;export const spawn=(command,args,options)=>{
 f.spawn.push({command,args,options});const child=new EventEmitter();child.unref=()=>{};process.nextTick(()=>child.emit(f.spawnError?'error':'spawn',new Error('spawn failed')));return child;};`,
 casclib:`export class Storage{openFile(name){f.events.push(name);if(f.missingMap)throw new Error('missing map');return {readAll:()=>Buffer.from('MPQ-test-fixture'),close(){f.events.push('file-close')}};}close(){f.events.push('storage-close')}}`,
 'casc-storage':`export const openGameCascStorage=async()=>({release:()=>f.events.push('release')});`,
 'config-manager':`export const configManager={get:key=>key==='war3Path'?f.root:{}};`,
 'war3-path':`export const normalizeWar3RootPath=value=>value;`,
 'game-channel':`export const getSelectedGameChannel=()=>f.channel;`,
 'mod-profile':`export const resolveModProfile=async()=>({graphics:f.graphics});export const assertShaderProfileSupported=()=>{};`,
 'war3-version':`export const detectWar3Version=async()=>({parts:f.version});`,
 'game-launcher':`export const GameLauncher={prepareLaunchAssets:async()=>f.events.push('prepare')};`,
 'local-release':`export const IS_TEST_RELEASE=f.test;`,
};
const out=await build({entryPoints:['src/Main/services/offline-test-launcher.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'offline-mocks',setup(p){
 p.onResolve({filter:/.*/},a=>{const key=a.path.replace(/^node:/,'').split('/').at(-1)!;if(mocks[key])return {path:key,namespace:'mock'};});
 p.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:'const f=globalThis.__offlineFixture;'+mocks[a.path]}));
}}]});
function load(){const module={exports:{} as any};new Function('require','module','exports',out.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);return module.exports;}
try{
 let api=load();api.registerOfflineTestLauncher();assert(f.events.includes('game:launch-offline-starter'));
 for(const [graphics,value] of [['sd','1'],['hd','2'],['de','3']]){
  f.graphics=graphics;await api.launchOfflineStarterMap();const p=f.spawn.at(-1);
  assert.equal(p.command,path.join(f.root,'offline.exe'));assert.equal(p.options.cwd,f.root);assert.equal(p.options.shell,false);
  assert.deepEqual(p.args,[path.join(f.data,'offline-test/(2)a_starter_map_losttemple_lv.w3x'),'--hd',value]);
  assert.equal(await fs.readFile(p.args[0],'utf8'),'MPQ-test-fixture');
 }
 assert(f.events.includes('war3.w3mod:maps\\(2)a_starter_map_losttemple_lv.w3x'));
 const count=f.spawn.length;
 f.channel='ptr';await assert.rejects(api.launchOfflineStarterMap(),/Retail/);f.channel='retail';
 f.version=[3,0,0];await assert.rejects(api.launchOfflineStarterMap(),/3.0.1/);f.version=[3,0,1,24371];
 await fs.rename(path.join(f.root,'offline.exe'),path.join(f.root,'offline.saved'));
 await assert.rejects(api.launchOfflineStarterMap(),/缺少 offline.exe/);await fs.rename(path.join(f.root,'offline.saved'),path.join(f.root,'offline.exe'));
 f.missingMap=true;await assert.rejects(api.launchOfflineStarterMap(),/CASC/);f.missingMap=false;
 assert.equal(f.spawn.length,count,'validation failures must never start an external process');
 f.spawnError=true;await assert.rejects(api.launchOfflineStarterMap(),/spawn failed/);f.spawnError=false;
 f.test=false;f.events=[];api=load();api.registerOfflineTestLauncher();assert.deepEqual(f.events,[]);
 await assert.rejects(api.launchOfflineStarterMap(),/仅供测试版/);
 for(const name of ['offline.exe','tools/Offline.EXE','quenching/offline.exe','unpacked/camp/offline.exe'])assert.equal(isDistributableAsset(name),false,name);
 console.log('PASS: TEST-only IPC/direct-call gate, fixed CASC starter map, SD/HD/DE arguments, root-only external tool, failure paths, no process on validation failure, Win/Mac asset exclusion. No real offline.exe/game was launched.');
}finally{assert.equal(path.dirname(root),parent);await fs.remove(root);delete (globalThis as any).__offlineFixture;}
