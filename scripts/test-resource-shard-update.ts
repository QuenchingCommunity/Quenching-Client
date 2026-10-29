import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { RESOURCE_ARCHIVES, RESOURCE_MANIFEST } from '../src/shared/bundled-resource-paths.mjs';
import { encodeSnapshot, snapshotDigest } from '../src/Main/services/file-sync-snapshot';
import { stageClientFileSync } from '../src/Main/services/client-update-service';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export async function run() {
  const {prepareResourceBundle}=await import(pathToFileURL(path.resolve('scripts/prepare-resource-bundle.mjs')).href);
  const previousTest=process.env.QUENCHING_CLIENT_UPDATE_TEST;
  process.env.QUENCHING_CLIENT_UPDATE_TEST='1';
  const parent=path.resolve('_tmp/resource-shards-20261028');await fs.ensureDir(parent);
  const task=await fs.mkdtemp(path.join(parent,'update-'));
  const requests:string[]=[],objects=new Map<string,Buffer>();
  const server=http.createServer((req,res)=>{const key=new URL(req.url!,'http://localhost').pathname;requests.push(key);const b=objects.get(key);if(!b){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Length':b.length});res.end(b);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const source=path.join(task,'assets/unpacked'),q=path.join(task,'assets/quenching');
    for(const [name,text] of Object.entries({'shaders/fixture/data.bls':'original shader','tx/UI.png':'UI','tile/terrain.slk':'terrain',
      'packages/zip-foliage-que/grass/albedo.dds':'color','packages/zip-foliage-que/grass/normal.dds':'normal'}))await fs.outputFile(path.join(source,name),text);
    await prepareResourceBundle(task,{requireLegacy:false});
    const capture=async()=>{
      const data:Record<string,Buffer>={'QMClient.exe':Buffer.from('unchanged launcher'),'resources/app.asar':Buffer.from('unchanged app')};
      for(const name of [...RESOURCE_ARCHIVES,RESOURCE_MANIFEST])data['resources/assets/quenching/'+name]=await fs.readFile(path.join(q,name));
      return data;
    };
    const before=await capture();
    await fs.writeFile(path.join(source,'shaders/fixture/data.bls'),'updated shader');
    const built=await prepareResourceBundle(task,{requireLegacy:false});
    assert.deepEqual(built.changedArchives,['resources-core.7z']);
    const after=await capture();
    const snapshot=(version:string,data:Record<string,Buffer>)=>{const files=Object.entries(data).map(([path,b])=>({path,size:b.length,sha256:hash(b)}));
      return {schema:1 as const,product:'quenching-client' as const,version,runtimeVersion:'33.1.0',generatedAt:'2026-10-28T00:00:00Z',filesDigest:snapshotDigest(files),files};};
    const previous=snapshot('3.7.0',before),latest=snapshot('3.7.1',after),inventory=encodeSnapshot(latest);
    objects.set('/latest.gz',inventory);
    for(const b of Object.values(after))objects.set('/objects/'+hash(b)+'.bin',b);
    const manifest:any={schema:2,product:'quenching-client',platform:'win32-x64',runtimeVersion:'33.1.0',targetVersion:'3.7.1',
      fileSync:{inventory:{size:inventory.length,sha256:hash(inventory),sources:[origin+'/latest.gz']},objects:[origin+'/objects/{sha256}.bin']}};
    const core='resources/assets/quenching/resources-core.7z',metadata='resources/assets/quenching/'+RESOURCE_MANIFEST;
    for(const alreadyInstalled of [false,true]) {
      const install=path.join(task,alreadyInstalled?'verified-local':'old-install');
      for(const [relative,b]of Object.entries(before))await fs.outputFile(path.join(install,relative),b);
      await fs.outputFile(path.join(install,'resources/assets/updater/client-files.json.gz'),encodeSnapshot(previous));
      if(alreadyInstalled)await fs.writeFile(path.join(install,core),after[core]);
      requests.length=0;
      const stage=path.join(install,'_tmp/update');
      const result=await stageClientFileSync(manifest,install,stage,'3.7.0');
      const downloaded=requests.filter(r=>r.startsWith('/objects/'));
      assert.deepEqual(new Set(downloaded),new Set([...(alreadyInstalled?[]:['/objects/'+hash(after[core])+'.bin']),'/objects/'+hash(after[metadata])+'.bin']));
      for(const name of RESOURCE_ARCHIVES.filter(n=>n!=='resources-core.7z')) {
        const file='resources/assets/quenching/'+name;
        assert.deepEqual(before[file],after[file],'unchanged pack bytes');
        assert(!result.some(r=>r.path===file),'unchanged pack not staged');
        assert.deepEqual(await fs.readFile(path.join(install,file)),before[file]);
      }
      assert.deepEqual(await fs.readFile(path.join(stage,'new',core)),after[core]);
    }
    console.log('PASS: real local HTTP client updater downloads only the changed 7z plus resource metadata, skips all four unchanged packs, and reuses a locally verified target archive.');
  } finally {
    if(previousTest===undefined)delete process.env.QUENCHING_CLIENT_UPDATE_TEST;else process.env.QUENCHING_CLIENT_UPDATE_TEST=previousTest;
    await new Promise<void>(resolve=>server.close(()=>resolve()));assert.equal(path.dirname(task),parent);await fs.remove(task);
  }
}
