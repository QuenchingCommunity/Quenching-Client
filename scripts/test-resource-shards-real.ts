import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { prepareBundledAssets } from '../src/Main/services/bundled-assets';
import { RESOURCE_ARCHIVES, RESOURCE_MANIFEST } from '../src/shared/bundled-resource-paths.mjs';
const parent=path.resolve('_tmp/resource-shards-20261028');await fs.ensureDir(parent);
const task=await fs.mkdtemp(path.join(parent,'independent-'));
const manifest=await fs.readJson(path.resolve('assets/quenching',RESOURCE_MANIFEST));
const hash=async(file:string)=>{const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');};
try {
  const report=[];
  for(const name of RESOURCE_ARCHIVES) {
    const assets=path.join(task,name,'assets'),q=path.join(assets,'quenching');await fs.ensureDir(q);
    await fs.copyFile(path.resolve('assets/quenching',name),path.join(q,name));
    await fs.writeJson(path.join(q,RESOURCE_MANIFEST),manifest);
    const files=Object.entries(manifest.files).filter(([,f]:any)=>f.archive===name).map(([file])=>file);
    const output=await prepareBundledAssets(assets,{cacheBase:path.join(task,name,'cache'),required:true,selections:files});
    let bytes=0;
    for(const file of files) {
      assert.equal(await hash(path.join(output!,file)),manifest.files[file].sha256,file);
      assert.equal((await fs.stat(path.join(output!,file))).size,manifest.files[file].size,file);
      bytes+=manifest.files[file].size;
    }
    assert.deepEqual((await fs.readdir(q)).sort(),[name,RESOURCE_MANIFEST].sort(),'No other archive was present');
    report.push({archive:name,compressedBytes:manifest.archives[name].size,files:files.length,expandedBytes:bytes,independentlyVerified:true});
    // Release each complete expansion before verifying the next pack.
    await fs.remove(path.join(task,name));
  }
  assert.equal(report.reduce((n,r)=>n+r.files,0),Object.keys(manifest.files).length);
  await fs.writeJson(path.join(parent,'independent-verification.json'),report,{spaces:2});
  console.log(JSON.stringify(report));
} finally {assert.equal(path.dirname(task),parent);await fs.remove(task);}
