import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import {patchAtmosphericLight,syncAtmosphericLight} from '../src/Main/services/atmospheric-light';
import {resourcePath,resourceSourceAlias,PTR_INDEPENDENT_SHADERS} from '../src/shared/bundled-resource-paths.mjs';
const parent=path.resolve('_tmp/atmospheric-ptr-20261029');await fs.ensureDir(parent);
const root=await fs.mkdtemp(path.join(parent,'test-'));
try{
 const q=path.join(root,'quenching');await fs.ensureDir(q);await fs.copy('assets/quenching/ui-misc.txt',path.join(q,'ui-misc.txt'));
 const original='[Misc]\r\nCustom=99\r\n[TerrainZFog]\r\nStyle=0\r\nStart=3000\r\nEnd=5000\r\nDensity=0.8\r\nMaxLinearDensity=0.8\r\nColor=255,0,0,0\r\nHeightStart=0\r\n[Other]\r\nValue=22\r\n';
 for(const channel of ['_retail_','_ptr_']){
  const build=path.join(root,channel),file=path.join(build,'ui/MiscData.txt');await fs.outputFile(file,original);
  const shader=path.join(build,'shaders/ps/foo.bls');await fs.outputFile(shader,'unchanged');
  await syncAtmosphericLight(build,q,false);
  assert(!await fs.pathExists(file),'off removes the complete MiscData override without a receipt');
  await syncAtmosphericLight(build,q,false);assert(!await fs.pathExists(file));
  await fs.writeFile(file,original);
  await syncAtmosphericLight(build,q,true);const enabled=await fs.readFile(file,'utf8');
  for(const line of ['Start=1400','End=5400','Density=0.8','MaxLinearDensity=0.8','Color=255,185,200,215'])assert(enabled.includes(line));
  assert(enabled.startsWith('[Misc]\r\nCustom=99'));assert(enabled.endsWith('[Other]\r\nValue=22\r\n'));assert(enabled.includes('Style=0'));
  await syncAtmosphericLight(build,q,true);assert.equal(await fs.readFile(file,'utf8'),enabled);
  await syncAtmosphericLight(build,q,false);assert(!await fs.pathExists(file));assert.equal(await fs.readFile(shader,'utf8'),'unchanged');
  await syncAtmosphericLight(build,q,true);await fs.remove(path.dirname(file));await syncAtmosphericLight(build,q,true);
  assert((await fs.readFile(file,'utf8')).includes('End=5400'),'survives UI replacement');
  await syncAtmosphericLight(build,q,false);assert(!await fs.pathExists(file));
 }
 const empty=path.join(root,'empty');await syncAtmosphericLight(empty,q,false);assert(!await fs.pathExists(path.join(empty,'ui')));
 await syncAtmosphericLight(empty,q,true);assert((await fs.readFile(path.join(empty,'ui/MiscData.txt'),'utf8')).includes('End=5400'));
 assert(patchAtmosphericLight('[Other]\nX=1\n',{Start:'1400'}).includes('[TerrainZFog]\nStart=1400'));
 assert.equal(PTR_INDEPENDENT_SHADERS,false);
 for(const mode of ['hd','de']){
  assert.equal(resourceSourceAlias(`shaders/shaders-ptr-${mode}/ps/a.bls`),`shaders/shaders-300-${mode}/ps/a.bls`);
  assert.equal(resourcePath(q,'shaders',`shaders-ptr-${mode}`),resourcePath(q,'shaders',`shaders-300-${mode}`));
 }
 console.log('PASS: atmosphere off deletes MiscData, repeated on/off, UI replacement, Retail/PTR, untouched shaders, cold default off, PTR physical source reuse.');
}finally{assert.equal(path.dirname(root),parent);await fs.remove(root);}
