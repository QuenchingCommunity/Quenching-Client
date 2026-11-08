import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import {defaultHdrExposure,resolveHdrExposure,validateHdrExposure,withHdrExposure} from '../src/shared/hdr-exposure';
import {renderingPresetSettings} from '../src/shared/rendering-presets';
import {setPostProcessingTonemapEnabled,setPostProcessingBloomEnabled,setPostProcessingAoEnabled} from '../src/Main/services/post-processing-config';

assert.equal(defaultHdrExposure('rpg'),0.85);assert.equal(defaultHdrExposure('standard'),1.1);assert.equal(defaultHdrExposure('battle'),1.4);
assert.equal(renderingPresetSettings('standard').hdrExposure,1.1);assert.equal(renderingPresetSettings('battle').hdrExposure,1.4);
for(const value of [0.75,0.9,1.2,1.8,2.4])assert.equal(validateHdrExposure(value),value);
for(const value of [NaN,Infinity,-1,0.74,2.41,'1.2',null])assert.throws(()=>validateHdrExposure(value));
const custom={lighting:'standard',hdr:true,hdrExposure:2.2,lightingBrightness:3};
assert.equal(withHdrExposure(custom,{lighting:'rpg'}).hdrExposure,0.85);
assert.equal(withHdrExposure(custom,{lighting:'battle'}).hdrExposure,1.4);
assert.equal(withHdrExposure(custom,{lightingBrightness:5}).hdrExposure,2.2);
assert.equal(withHdrExposure(custom,{hdr:false}).hdrExposure,2.2);
assert.equal(resolveHdrExposure({lighting:'rpg'}),0.85);assert.equal(resolveHdrExposure({lighting:'battle',hdrExposure:NaN}),1.4);
assert.equal(resolveHdrExposure({lighting:'battle',hdrExposure:1.8}),1.8,'preserve saved custom brightness');

const parent=path.resolve('_tmp/hdr-exposure-20261106');await fs.ensureDir(parent);
const root=await fs.mkdtemp(path.join(parent,'test-')),branch=path.join(root,'_retail_'),ptr=path.join(root,'_ptr_');
const file=path.join(branch,'PostProcessingConfig.txt'),rename=fs.rename;
try{
  const before='\uFEFF[ASSAO]\r\nEnabled=0\r\nRadius=64\r\n[Tonemap]\r\nEnabled=0\r\nExposure=0.88\r\nCustom=keep\r\n[Bloom]\r\nEnabled=1\r\nIntensity=0.9\r\n';
  await fs.outputFile(file,before);await fs.outputFile(path.join(ptr,'PostProcessingConfig.txt'),before);
  await setPostProcessingTonemapEnabled(branch,true,1.8);
  assert.equal(await fs.readFile(file,'utf8'),before.replace('[Tonemap]\r\nEnabled=0','[Tonemap]\r\nEnabled=1').replace('Exposure=0.88','Exposure=1.8'));
  assert.equal(await fs.readFile(path.join(ptr,'PostProcessingConfig.txt'),'utf8'),before);
  assert.equal(await setPostProcessingTonemapEnabled(branch,true,1.8),false);
  await setPostProcessingTonemapEnabled(branch,false,1.8);assert.match(await fs.readFile(file,'utf8'),/\[Tonemap\]\r\nEnabled=0\r\nExposure=1.8/);
  await Promise.all([setPostProcessingTonemapEnabled(branch,true,2.4),setPostProcessingBloomEnabled(branch,false),setPostProcessingAoEnabled(branch,true)]);
  const after=await fs.readFile(file,'utf8');assert.match(after,/Exposure=2.4/);assert.match(after,/\[Bloom\]\r\nEnabled=0/);assert.match(after,/\[ASSAO\]\r\nEnabled=1/);
  assert.match(after,/Custom=keep/);await assert.rejects(setPostProcessingTonemapEnabled(branch,true,5));assert.equal(await fs.readFile(file,'utf8'),after);
  fs.rename=(async()=>{throw Error('injected exposure rename failure');}) as typeof fs.rename;
  try{await assert.rejects(setPostProcessingTonemapEnabled(branch,true,0.75),/injected/);}finally{fs.rename=rename;}
  assert.equal(await fs.readFile(file,'utf8'),after);assert.deepEqual(await fs.readdir(branch),['PostProcessingConfig.txt']);
  await fs.writeFile(file,'[Bloom]\nEnabled=1\n');await setPostProcessingTonemapEnabled(branch,true,0.75);
  const missing=await fs.readFile(file,'utf8');assert.match(missing,/\[Tonemap\]/);assert.match(missing,/Enabled=1/);assert.match(missing,/Exposure=0.75/);
  await fs.writeFile(file,'[Tonemap]\nEnabled=0\nEnabled=0\nExposure=1\nexposure=2\n');await setPostProcessingTonemapEnabled(branch,true,1.2);
  const dedup=await fs.readFile(file,'utf8');assert.equal((dedup.match(/Enabled=/g)||[]).length,1);assert.equal((dedup.match(/exposure=/ig)||[]).length,1);
  console.log('PASS: lighting defaults, custom exposure persistence, endpoints/invalid input, Tonemap Enabled+Exposure, Retail/PTR isolation, AO/Bloom/BOM/CRLF preservation, concurrent writes, no-op reuse, duplicate keys and failed-write recovery.');
}finally{fs.rename=rename;assert.equal(path.dirname(root),parent);await fs.remove(root);}
