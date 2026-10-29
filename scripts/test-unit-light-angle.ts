import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import rotations from '../assets/unpacked/experimental/de-unit-rotations.json';
import { lightDirection, lightQuaternionAtAzimuth, buildRotatingLightTrack, validateUnitLightAngle } from '../src/shared/dnc-rotation';
import { renderDncLighting } from '../src/Main/services/dnc-lighting';
import { patchRotatingUnitLighting, ROTATING_UNIT_FILES, unitRotationBlock } from '../src/Main/services/rotating-lighting';
const azimuth=(q:readonly number[])=>{const d=lightDirection(q);return (Math.atan2(d[1],d[0])*180/Math.PI+360)%360;};
const near=(a:number,b:number)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
for(const angle of [0,45,90,180,270,360]) {
  const q=lightQuaternionAtAzimuth([.25,.25,.7,0],angle);
  near((azimuth(q)+360)%360,angle%360);
  near(lightDirection(q)[2],lightDirection([.25,.25,.7,0])[2]);
  const original=buildRotatingLightTrack(rotations.keyframes,rotations.interval,[0,60000]);
  const track=buildRotatingLightTrack(rotations.keyframes,rotations.interval,[0,60000],angle);
  near(azimuth(track.find(k=>k.frame===15000)!.value),angle%360);
  assert.deepEqual(track[0].value,track.at(-1)!.value);
  track.forEach((k,i)=>near(lightDirection(k.value)[2],lightDirection(original[i].value)[2]));
}
for(const invalid of [-1,361,NaN,Infinity,'90'])assert.throws(()=>validateUnitLightAngle(invalid));
const parent=path.resolve('_tmp/unit-light-angle-20261028');await fs.ensureDir(parent);
const root=await fs.mkdtemp(path.join(parent,'test-'));
try {
  let files=0;
  for(const pack of ['dnc20','dnc30-hd','dnc30-de']) {
    const source=path.resolve('assets/unpacked/dnc',pack),target=path.join(root,pack);
    await fs.copy(source,target);
    const entries=(await fs.readdir(source,{recursive:true})).filter(f=>String(f).endsWith('.mdl'));
    const options={isVersion30:pack!=='dnc20',deMode:pack.endsWith('-de')};
    for(const mode of ['standard','battle','rpg']) {
      for(const relative of entries) {
        const input=await fs.readFile(path.join(source,String(relative)),'utf8');
        const original=renderDncLighting(input,String(relative),mode,3,options);
        const angled=renderDncLighting(input,String(relative),mode,3,{...options,unitLightAngle:120});
        if(String(relative).includes('terrain'))assert.equal(angled,original,'terrain byte-identical');
        else if(String(relative).includes('unit')) {
          const strip=(s:string)=>s.replace(/^[\t ]*Rotation\s+\d+\s*\{[^\r\n]*\r?\n[\s\S]*?^[\t ]*\}/gm,'ROTATION');
          assert.equal(strip(angled),strip(original),'only unit rotations change');
        }
        files++;
      }
    }
    for(const angle of [120,300]) {
      await patchRotatingUnitLighting(target,source,false,'standard',3,{...options,unitLightAngle:angle},undefined,true);
      for(const relative of entries.filter(f=>String(f).includes('terrain'))) assert.deepEqual(await fs.readFile(path.join(target,String(relative))),await fs.readFile(path.join(source,String(relative))));
      await patchRotatingUnitLighting(target,source,true,'standard',3,{...options,unitLightAngle:angle});
      for(const relative of ROTATING_UNIT_FILES)assert(Number(unitRotationBlock(await fs.readFile(path.join(target,relative),'utf8')).match(/Rotation (\d+)/)![1])>=49);
      await patchRotatingUnitLighting(target,source,false,'standard',3,{...options,unitLightAngle:angle});
    }
  }
  console.log(`PASS: 0–360 absolute azimuth, elevation/roll convention, 06:00 rotating anchor, closed day cycle, ${files} models/modes, units-only atomic updates and angle-preserving rotation off`);
} finally {assert.equal(path.dirname(root),parent);await fs.remove(root);}
