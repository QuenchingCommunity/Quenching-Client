import assert from 'node:assert/strict';
import fs from 'fs-extra';
import nodeFs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { prepareResourceBundle } from './prepare-resource-bundle.mjs';
import { prepareBundledAssets, deferBundledResourcePreparation, ensureResourceSelection } from '../src/Main/services/bundled-assets';
import { RESOURCE_ARCHIVES, RESOURCE_MANIFEST } from '../src/shared/bundled-resource-paths.mjs';
import { afterResourceFirstPaint, ResourceStartupTask, type ResourceStartupStatus } from '../src/shared/resource-startup';
import { resourceCacheLocation } from '../src/Main/services/resource-cache-location';

const frames=new Map<number,()=>void>();let frameId=0,visible=false,started=0,completed=0,failures=0;
const host={requestAnimationFrame:(callback:()=>void)=>{frames.set(++frameId,callback);return frameId;},cancelAnimationFrame:(id:number)=>{frames.delete(id);}};
const updates:ResourceStartupStatus[]=[];let finish!:()=>void;
const task=new ResourceStartupTask({prepare:async notify=>{assert(visible);started++;notify({firstRun:true,percent:0});
  notify({firstRun:true,percent:50});notify({firstRun:true,percent:50});await new Promise<void>(resolve=>{finish=resolve;});},
  publish:status=>updates.push(status),complete:()=>{completed++;},failure:()=>{failures++;}});
const paint=()=>{const work=[...frames.values()];frames.clear();work.forEach(callback=>callback());};
afterResourceFirstPaint(host,()=>{task.start();});
assert.equal(started,0);paint();await Promise.resolve();assert.equal(started,0,'first frame paints before any extraction');
visible=true;paint();await Promise.resolve();assert.equal(started,1);task.start();assert.equal(started,1,'no duplicate startup jobs');
assert.equal(completed,0);finish();await task.settled();assert.equal(completed,1);assert.equal(task.getStatus().phase,'ready');
assert.equal(updates.filter(s=>s.firstRun && s.percent===50).length,1,'duplicate progress suppressed');
const cancel=afterResourceFirstPaint(host,()=>{throw new Error('cancelled paint started work');});cancel();paint();paint();
const failed=new ResourceStartupTask({prepare:async notify=>{notify({firstRun:true,percent:10});throw new Error('decoder failed');},
  publish:()=>{},complete:()=>{throw new Error('failed preparation acknowledged healthy');},failure:()=>{failures++;}});
failed.start();await failed.settled();assert.equal(failed.getStatus().phase,'failed');assert.equal(failures,1);

const parent=path.resolve('_tmp/resource-startup-20261028');await fs.ensureDir(parent);
const root=await fs.mkdtemp(path.join(parent,'test-')),assets=path.join(root,'assets'),source=path.join(assets,'unpacked'),q=path.join(assets,'quenching');
const cacheBase=path.join(root,'portable 淬火');
const originalStream=nodeFs.createReadStream,originalRename=fs.rename;
let track=false;const reads:string[]=[];
(nodeFs as any).createReadStream=(file:any,...args:any[])=>{if(track)reads.push(String(file));return (originalStream as any)(file,...args);};syncBuiltinESMExports();
try {
  const core='shaders/fixture/data.bls',ui='tx/ui.png';
  const payload={'shaders/fixture/data.bls':'shader-old','tx/ui.png':'image-old','tile/data.slk':'terrain',
    'packages/zip-foliage-que/grass/albedo.dds':'color','packages/zip-foliage-que/grass/normal.dds':'normal'};
  for(const [file,text]of Object.entries(payload))await fs.outputFile(path.join(source,file),text);
  await prepareResourceBundle(root,{requireLegacy:false});
  const capture=async()=>Object.fromEntries(await Promise.all([...RESOURCE_ARCHIVES,RESOURCE_MANIFEST].map(async name=>[name,await fs.readFile(path.join(q,name))])));
  const before=await capture();
  const firstRun:boolean[]=[],progress:number[]=[];
  const location=resourceCacheLocation(true,path.join(cacheBase,'QMClient.exe'),assets,'win32');
  assert.equal(location.cacheBase,cacheBase);
  assert.equal(resourceCacheLocation(true,path.join(cacheBase,'QM.app','Contents','MacOS','QM'),assets,'darwin').cacheBase,cacheBase);
  assert.equal(resourceCacheLocation(false,process.execPath,assets).cacheBase,path.join(root,'_tmp','runtime-resources'));
  const options={...location,required:true,
    onPreparation:(first:boolean)=>firstRun.push(first),onProgress:(percent:number)=>progress.push(percent)};
  track=true;
  const cached=(await prepareBundledAssets(assets,options))!;
  assert.equal(cached,path.join(cacheBase,'unpacked'),'resource folders sit directly beside EXE, with no current/content-ID nesting');
  assert.equal(await ensureResourceSelection(q,[ui]),cached,'on-demand consumers reuse the same portable root');
  assert.equal(firstRun.at(-1),true);assert.equal(progress.at(-1),100);
  assert(progress.every((p,i)=>i===0 || p>=progress[i-1]));
  assert.deepEqual(reads,[],'cold extraction uses native CRC/size, without archive or expanded-file SHA rereads');
  for(const [name,text]of Object.entries(payload))assert.equal(await fs.readFile(path.join(cached,name),'utf8'),text);
  const unchangedStamp=(await fs.stat(path.join(cached,ui))).mtimeMs;
  const hold=path.join(root,'hold');await fs.ensureDir(hold);
  for(const name of RESOURCE_ARCHIVES)await fs.rename(path.join(q,name),path.join(hold,name));
  progress.length=0;
  assert.equal(await prepareBundledAssets(assets,options),cached);
  assert.equal(firstRun.at(-1),false);assert.deepEqual(progress,[100]);assert.deepEqual(reads,[],'warm start does not read 7z payloads or hash cached files');
  for(const name of RESOURCE_ARCHIVES)await fs.rename(path.join(hold,name),path.join(q,name));

  track=false;await fs.writeFile(path.join(source,core),'shader-new');await prepareResourceBundle(root,{requireLegacy:false});
  const after=await capture();track=true;reads.length=0;
  assert.equal(await prepareBundledAssets(assets,options),cached,'version changes retain a stable expanded root');
  assert.equal(firstRun.at(-1),false);assert.equal(await fs.readFile(path.join(cached,core),'utf8'),'shader-new');
  assert.equal((await fs.stat(path.join(cached,ui))).mtimeMs,unchangedStamp);
  assert.deepEqual(reads,[],'different same-name version uses saved hashes and replaces only changed files');
  for(const [name,bytes]of Object.entries(before))await fs.writeFile(path.join(q,name),bytes as Buffer);
  await prepareBundledAssets(assets,options);
  assert.equal(await fs.readFile(path.join(cached,core),'utf8'),'shader-old','rollback restores the old client content');
  assert.deepEqual(reads,[]);

  const oldUi=await fs.stat(path.join(cached,ui));await fs.writeFile(path.join(cached,ui),'image-bad');await fs.utimes(path.join(cached,ui),oldUi.atime,oldUi.mtime);
  reads.length=0;await prepareBundledAssets(assets,options);
  assert.deepEqual(reads,[path.join(cached,ui)],'only a cache file modified outside the client is hashed');
  assert.equal(await fs.readFile(path.join(cached,ui),'utf8'),'image-old');
  for(const [name,bytes]of Object.entries(after))await fs.writeFile(path.join(q,name),bytes as Buffer);
  let fail=true;
  (fs as any).rename=async(from:string,to:string)=>{
    if(fail && from.includes(`${path.sep}prepared${path.sep}`) && to===path.join(cached,core)){fail=false;throw new Error('startup swap failed');}
    return originalRename(from,to);
  };
  try {await assert.rejects(prepareBundledAssets(assets,options),/startup swap failed/);}finally{fs.rename=originalRename;}
  assert.equal(await fs.readFile(path.join(cached,core),'utf8'),'shader-old','failed silent replacement restores existing content');
  await prepareBundledAssets(assets,options);assert.equal(await fs.readFile(path.join(cached,core),'utf8'),'shader-new');

  track=false;
  const legacyBase=path.join(root,'legacy-cache');
  const legacy=(await prepareBundledAssets(assets,{cacheBase:legacyBase,required:true}))!;
  const ready=await fs.readJson(path.join(legacy,'.ready.json'));
  ready.schema=2;delete ready.legacyId;for(const record of Object.values(ready.files) as any[])delete record.sha256;
  await fs.writeJson(path.join(legacy,'.ready.json'),ready);
  await fs.ensureDir(path.join(legacyBase,'unpacked/current'));
  await fs.writeJson(path.join(legacyBase,'unpacked/current/.ready.json'),{schema:3,id:'empty-interrupted-start',files:{}});
  track=true;reads.length=0;let legacyFirst=true;
  const adopted=(await prepareBundledAssets(assets,{...options,flatCache:false,cacheBase:legacyBase,onPreparation:first=>{legacyFirst=first;}}))!;
  assert.equal(path.basename(adopted),'current');assert(!await fs.pathExists(legacy));assert.equal(legacyFirst,false);
  assert.deepEqual(reads,[],'known same-content legacy cache is adopted without copying or hashing the tree');
  let release!:()=>void,consumerFinished=false;
  deferBundledResourcePreparation(new Promise<void>(resolve=>{release=resolve;}));
  const gated={...options,cacheBase:path.join(root,'gated-cache')};
  const consumer=prepareBundledAssets(assets,{...gated,selections:[core]}).then(()=>{consumerFinished=true;});
  try {
    const metadata=(await prepareBundledAssets(assets,{...gated,selections:[]}))!;
    assert.equal(consumerFinished,false);assert(!await fs.pathExists(path.join(metadata,core)),'early background consumers cannot unpack before the paint handshake');
    await prepareBundledAssets(assets,{...gated,startup:true});
  } finally {release();}
  await consumer;assert.equal(consumerFinished,true);
  console.log('PASS: first-paint startup, cold progress, warm silence, no bulk SHA rereads, same-name version replacement, unchanged-file reuse, tamper-only hashing, rollback and old-cache adoption.');
} finally {
  (nodeFs as any).createReadStream=originalStream;syncBuiltinESMExports();fs.rename=originalRename;
  assert.equal(path.dirname(root),parent);await fs.remove(root);
}
