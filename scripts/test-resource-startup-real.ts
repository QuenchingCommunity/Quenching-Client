import assert from 'node:assert/strict';
import fs from 'fs-extra';
import nodeFs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { prepareBundledAssets } from '../src/Main/services/bundled-assets';
const parent=path.resolve('_tmp/resource-startup-20261028');await fs.ensureDir(parent);
const root=await fs.mkdtemp(path.join(parent,'real-'));
const assets=path.resolve('assets'),manifest=await fs.readJson(path.join(assets,'quenching/resources.manifest.json'));
const original=nodeFs.createReadStream;
let hashReads=0;
(nodeFs as any).createReadStream=(...args:any[])=>{hashReads++;return (original as any)(...args);};syncBuiltinESMExports();
try {
  const firstFlags:boolean[]=[],progress:number[]=[];
  const options={cacheBase:path.join(root,'cache'),sharedCache:true,verification:'light' as const,required:true,
    onPreparation:(first:boolean)=>firstFlags.push(first),onProgress:(percent:number)=>progress.push(percent)};
  const cold=performance.now();const cache=(await prepareBundledAssets(assets,options))!;
  const coldMs=Math.round(performance.now()-cold);
  assert.equal(firstFlags.at(-1),true);assert.equal(progress.at(-1),100);assert.equal(hashReads,0);
  assert(progress.every((p,i)=>!i || p>=progress[i-1]));
  const marker=await fs.readJson(path.join(cache,'.ready.json'));
  assert.equal(Object.keys(marker.files).length,Object.keys(manifest.files).length);
  for(const name of Object.keys(manifest.files))assert.equal((await fs.stat(path.join(cache,name))).size,manifest.files[name].size);
  const warm=performance.now();await prepareBundledAssets(assets,options);const warmMs=Math.round(performance.now()-warm);
  assert.equal(firstFlags.at(-1),false);assert.equal(hashReads,0);
  const report={files:Object.keys(manifest.files).length,expandedBytes:Object.values(manifest.files).reduce((n:number,f:any)=>n+f.size,0),
    coldMs,warmMs,bulkHashReads:hashReads,firstLaunchHadProgress:true,warmLaunchSilent:true};
  await fs.writeJson(path.join(parent,'real-verification.json'),report,{spaces:2});console.log(JSON.stringify(report));
}finally{(nodeFs as any).createReadStream=original;syncBuiltinESMExports();assert.equal(path.dirname(root),parent);await fs.remove(root);}
