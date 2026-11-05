import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import { prepareBundledAssets } from '../src/Main/services/bundled-assets';
import { resourceCacheLocation } from '../src/Main/services/resource-cache-location';
import { resourcePath, BOOTSTRAP_ASSETS } from '../src/shared/bundled-resource-paths.mjs';
import { extractZipArchive } from '../src/Main/services/zip-extraction';
import { withShaderBundle } from '../src/Main/services/shader-bundle';

const parent=path.resolve('_tmp/portable-resources-20261102');await fs.ensureDir(parent);
const root=await fs.mkdtemp(path.join(parent,'real-'));
const assets=path.resolve('assets'),q=path.join(assets,'quenching');
const manifest=await fs.readJson(path.join(q,'resources.manifest.json'));
try {
  const exe=path.join(root,'客户端 文件夹','QMClient.exe');
  const flags:boolean[]=[],progress:number[]=[];
  const options={...resourceCacheLocation(true,exe,assets,'win32'),required:true,
    onPreparation:(first:boolean)=>flags.push(first),onProgress:(percent:number)=>progress.push(percent)};
  const start=performance.now(),cache=(await prepareBundledAssets(assets,options))!;
  const coldMs=Math.round(performance.now()-start);
  assert.equal(cache,path.join(path.dirname(exe),'unpacked'));
  assert.equal(flags.at(-1),true);assert.equal(progress.at(-1),100);
  for(const [name,record] of Object.entries(manifest.files) as [string,{size:number}][]) {
    const resolved=resourcePath(q,name);
    assert.equal(resolved,path.join(cache,name));
    assert.equal((await fs.stat(resolved)).size,record.size);
  }
  for(const name of BOOTSTRAP_ASSETS)assert.equal(resourcePath(q,name),path.join(q,name));
  const warm=performance.now();await prepareBundledAssets(assets,options);const warmMs=Math.round(performance.now()-warm);
  assert.equal(flags.at(-1),false);
  const samples=Object.keys(manifest.files).filter(name=>name.startsWith('dnc/')||name.startsWith('skin/')||name.startsWith('water/')||name.startsWith('tile/'));
  const groups=new Set<string>();
  for(const name of samples){const group=name.split('/')[0];if(groups.has(group))continue;groups.add(group);
    assert.deepEqual(await fs.readFile(resourcePath(q,name)),await fs.readFile(path.join(assets,'unpacked',name)));}
  const ui='ui-que/framedef/ui/inventorybar.fdf';
  await extractZipArchive(path.join(q,'zip-ui-20.zip'),path.join(root,'ui-output'),{mapFile:name=>name===ui?name:null});
  assert.deepEqual(await fs.readFile(path.join(root,'ui-output',ui)),await fs.readFile(path.join(assets,'unpacked/packages/zip-ui-20',ui)));
  const logicalPackages:string[]=[];
  for(const [archive,prefix] of Object.entries(manifest.packages) as [string,string][]) {
    const sample=Object.entries(manifest.files).filter(([name])=>name.startsWith(prefix))
      .sort((a:any,b:any)=>a[1].size-b[1].size)[0]?.[0];
    assert(sample,`Empty resource group: ${archive}`);
    const relative=sample.slice(prefix.length),output=path.join(root,'groups',archive);
    await extractZipArchive(path.join(q,archive),output,{mapFile:name=>name===relative?name:null});
    assert.deepEqual(await fs.readFile(path.join(output,relative)),await fs.readFile(resourcePath(q,sample)));
    logicalPackages.push(archive);
  }
  await withShaderBundle(q,'shaders-300-hd',root,async source=>{
    assert.equal(source,q);
    assert(await fs.pathExists(resourcePath(source,'shaders','shaders-300-hd')));
  });
  assert.deepEqual(await fs.readdir(path.join(path.dirname(exe),'_tmp')),[],'successful preparation removes temporary transactions');
  const report={files:Object.keys(manifest.files).length,coldMs,warmMs,portableRootVerified:true,uiExtractionVerified:true,
    shaderConsumerVerified:true,bootstrapPathsPreserved:true,representativeSourcesCompared:[...groups],logicalPackages,transactionsCleaned:true};
  await fs.writeJson(path.join(parent,'real-dependencies.json'),report,{spaces:2});
  console.log(JSON.stringify(report));
} finally {
  assert.equal(path.dirname(root),parent);assert(!(await fs.lstat(root)).isSymbolicLink());await fs.remove(root);
}
