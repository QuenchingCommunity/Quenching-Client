import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { build } from 'esbuild';
import JSZip from 'jszip';
import { createSettingsProgressReporter } from '../src/shared/settings-progress';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'lighting-progress-'));
const fixture:any={handler:null,fail:false,release:null};
(globalThis as any).__lightingProgressFixture=fixture;
async function isolated(entry:string,mocks:Record<string,string>){
  const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',
    plugins:[{name:'progress-fixture',setup(api){
      api.onResolve({filter:/.*/},args=>{const name=args.path.split('/').at(-1)!;if(mocks[name])return{path:name,namespace:'fixture'};});
      api.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:'const f=globalThis.__lightingProgressFixture;'+mocks[args.path]}));
    }}]});
  const module={exports:{} as any};
  new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  return module.exports;
}
try{
  const reports:number[]=[];
  const report=createSettingsProgressReporter((_s,p)=>reports.push(p));
  report('shaders',20);report('shaders',20.9);report('shaders',10);report('shaders',NaN);report('dnc',40);
  assert.deepEqual(reports,[20,40],'duplicate, backwards and invalid progress suppressed');

  const {withShaderBundle}=await isolated('export {withShaderBundle} from "./src/Main/services/shader-bundle";',{
    'fog-shader-override':'export const shaderToggleResourcePaths=()=>[];',
  });
  const q=path.join(root,'quenching');await fs.ensureDir(q);
  const zip=new JSZip();
  zip.file('shaders/shaders-300-hd/ps/standard/hd.bls','shader');
  zip.file('shaders/shaders-300-hd/ps/melee/hd.bls','other');
  zip.file('unrelated/file.txt','ignored');
  for(const entry of Object.values(zip.files))if(!entry.dir)await fs.outputFile(path.join(q,entry.name),await entry.async('nodebuffer'));
  const extracted:number[]=[];
  await withShaderBundle(q,'shaders-300-hd',root,async(stage:string)=>{
    assert.equal(stage,q,'Per-effect calls reuse prepared resources');
    assert.equal(extracted.at(-1),100);
    assert(await fs.pathExists(path.join(stage,'shaders/shaders-300-hd/ps/standard/hd.bls')));
    assert(await fs.pathExists(path.join(stage,'shaders/shaders-300-hd/ps/melee/hd.bls')),'Other cached sources remain available');
  },{prefixes:['shaders/shaders-300-hd/ps/standard/']},(p:number)=>extracted.push(p));

  const {registerMdlHandlers}=await isolated('export {registerMdlHandlers} from "./src/Main/ipc/mdl-handlers";',{
    electron:'export const ipcMain={handle:(_name,fn)=>{f.handler=fn;}};',
    'config-manager':'export const configManager={get:k=>k==="modSettings"?{}:"fixture-game"};',
    'asset-sync':`export const AssetSyncService={getAssetsDir:async()=>"assets"};
      export const syncLightingResources=async(_a,_b,_c,_d,options)=>{
        options.onProgress('shaders',25);await new Promise(resolve=>{f.release=resolve;});
        if(f.fail)throw new Error('fixture copy failed');options.onProgress('dnc',80);
      };`,
  });
  registerMdlHandlers();
  const events:any[]=[];
  const event={sender:{isDestroyed:()=>false,send:(channel:string,payload:any)=>events.push({channel,...payload})}};
  let complete=false;
  const pending=fixture.handler(event,'game','battle',4,'standard',3,'request-1').then(()=>{complete=true;});
  while(!fixture.release)await new Promise(resolve=>setImmediate(resolve));
  assert(!complete&&events.some(e=>e.percent===25),'IPC forwards live progress while work is still pending');
  assert(!events.some(e=>e.percent===100));
  fixture.release();await pending;
  assert.equal(events.at(-1).percent,100);
  assert(events.every(e=>e.requestId==='request-1'&&e.operation==='lighting'&&e.channel==='mod:profile-progress'));
  fixture.fail=true;fixture.release=null;events.length=0;
  const failed=fixture.handler(event,'game','standard',3,'battle',4,'request-2');
  const rejection=assert.rejects(failed,/fixture copy failed/);
  while(!fixture.release)await new Promise(resolve=>setImmediate(resolve));
  fixture.release();await rejection;
  assert(!events.some(e=>e.percent===100),'failed work never reports completion');
  console.log('PASS: real ZIP extraction progress, live IPC delivery before completion, request isolation, failure handling and monotonic reports');
}finally{
  await fs.remove(root);delete(globalThis as any).__lightingProgressFixture;
}
