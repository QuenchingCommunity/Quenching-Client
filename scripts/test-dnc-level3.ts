import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'fs-extra';
import { applyDncLighting, applyFinalizedDncBrightness, getBrightnessMultiplier, getAmbientBrightnessOffset } from '../src/Main/services/dnc-lighting';

async function list(root: string, current=root): Promise<string[]> {
  const files: string[]=[];
  for(const e of await fs.readdir(current,{withFileTypes:true})) {
    if(e.isDirectory()) files.push(...await list(root,path.join(current,e.name)));
    else if(e.name.endsWith('.mdl')) files.push(path.relative(root,path.join(current,e.name)));
  }
  return files.sort();
}
function values(text: string, name: string): number[] {
  const scalar='[-+]?(?:\\d*\\.\\d+|\\d+\\.?\\d*)(?:[eE][-+]?\\d+)?';
  const fixed=[...text.matchAll(new RegExp(`^\\s*static\\s+${name}\\s+(${scalar})`,'gmi'))].map(m=>Number(m[1]));
  const tracks=[...text.matchAll(new RegExp(`^\\s*${name}\\s+\\d+\\s*\\{([^{}]*)\\}`,'gmi'))]
    .flatMap(m=>[...m[1].matchAll(new RegExp(`^\\s*\\d+:\\s*(${scalar})`,'gmi'))].map(k=>Number(k[1])));
  return [...fixed,...tracks];
}
const strip=(text: string)=>text
  .replace(/^([\t ]*static\s+(?:Intensity|AmbIntensity)\s+)[-+\d.eE]+/gmi,'$1VALUE')
  .replace(/^([\t ]*(?:Intensity|AmbIntensity)\s+\d+\s*\{)([^{}]*)(\})/gmi,
    (_m,h,b,e)=>h+b.replace(/(^[\t ]*(?:\d+:|InTan|OutTan)\s*)[-+\d.eE]+/gmi,'$1VALUE')+e);
const round=(n: number)=>Math.round(n*1e6)/1e6;
const parent=path.resolve('_tmp/battle-terrain-package-20261028');
await fs.ensureDir(parent);
const root=await fs.mkdtemp(path.join(parent,'dnc-level3-'));
const stripRotation=(text:string)=>text.replace(/^[\t ]*Rotation\s+\d+\s*\{[^\r\n]*\r?\n[\s\S]*?^[\t ]*\}/gm,'ROTATION');
let checked=0;
try {
  for(const deMode of [false,true]) {
    const source=path.resolve('assets/unpacked/dnc',deMode?'dnc30-de':'dnc30-hd');
    const files=await list(source);
    for(const mode of ['standard','battle'])for(const level of [1,2,3,4,5]) {
      const factor=[0.7,0.85,1,1.15,1.3][level-1],offset=round((level-3)*0.015+(mode==='battle'?0.04:0));
      assert.equal(getBrightnessMultiplier(level,mode,{isVersion30:true,deMode}),factor);
      assert.equal(getAmbientBrightnessOffset(level,mode),offset);
      const target=path.join(root,String(deMode),mode,String(level));
      await fs.copy(source,target);
      await applyDncLighting(target,mode,level,{isVersion30:true,deMode});
      for(const file of files) {
        const before=await fs.readFile(path.join(source,file),'utf8'),after=await fs.readFile(path.join(target,file),'utf8');
        assert.deepEqual(values(after,'Intensity'),values(before,'Intensity').map(n=>round(n*factor)),`${mode}/${level}/${file}: Intensity`);
        assert.deepEqual(values(after,'AmbIntensity'),values(before,'AmbIntensity').map(n=>round(n+offset)),`${mode}/${level}/${file}: AmbIntensity`);
        if(mode==='battle' && path.basename(file).includes('terrain')) {
          assert.match(after,/0: \{ 0\.25, 0\.25, 0\.75, 0 \}/,'battle terrain rotation');
          assert.equal(stripRotation(strip(after)),stripRotation(strip(before)),'only brightness and terrain rotation may change: '+file);
        } else assert.equal(strip(after),strip(before),'only brightness values may change: '+file);
        if(level===3&&mode==='standard')assert.equal(after,before,'level 3 must be byte-identical');
        checked++;
      }
    }
    const standard=path.join(root,String(deMode),'standard','3');
    for(const [mode,reference] of [['rpg',standard],['melee',path.join(root,String(deMode),'battle','3')]]) {
      const target=path.join(root,String(deMode),mode);await fs.copy(source,target);
      await applyDncLighting(target,mode,3,{isVersion30:true,deMode});
      for(const file of files)assert.equal(await fs.readFile(path.join(target,file),'utf8'),await fs.readFile(path.join(reference,file),'utf8'),mode+' alias');
    }
  }
  const imported=await fs.readJson('artifacts/dnc-lighting-20261026/dnc-level3-final-input.json');
  for(const [key,text]of Object.entries(imported.edits)) {
    const [id,file]=key.split('|');
    const pack=id.startsWith('hd301/')?'dnc30-hd':'dnc30-de';
    assert.equal(await fs.readFile(path.join('assets/unpacked/dnc',pack,file),'utf8'),text,'user final level-3 text preserved: '+key);
  }
  // Fractional ambient increments retain all three decimals; no clamping of underground light.
  assert.ok(applyFinalizedDncBrightness('static AmbIntensity -0.05,\nstatic Intensity 10,',2,'standard').includes('-0.065'));
  const animated='AmbIntensity 2 {\n Linear,\n 0: -0.05,\n 60000: 0.1,\n}\nIntensity 1 {\n Linear,\n 0: 10,\n}\n';
  const transformed=applyFinalizedDncBrightness(animated,2,'battle');
  assert.deepEqual(values(transformed,'AmbIntensity'),[-0.025,0.125]);
  assert.deepEqual(values(transformed,'Intensity'),[8.5]);
  for(const [i,factor]of [0.7,0.9,1.1,1.3,1.5].entries())assert.equal(getBrightnessMultiplier(i+1,'battle',{isVersion30:false}),factor,'2.04 legacy multiplier');
  console.log(`PASS: ${checked} finalized HD/DE files; original 3rd level, all brightness steps, battle offsets, color/rotation/shadow preservation, aliases and 16 user edits`);
} finally { await fs.remove(root); }
