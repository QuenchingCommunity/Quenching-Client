import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import {renderDncLighting} from '../src/Main/services/dnc-lighting';
import {resolveUnitLightSettings} from '../src/shared/unit-light-settings';

const rotations=(text:string)=>[...text.replaceAll('\r\n','\n').matchAll(/^[\t ]*Rotation\s+\d+\s*\{[^\r\n]*\n[\s\S]*?^[\t ]*\}/gm)].map(match=>match[0]);
let checked=0,unitsChanged=0;
for(const pack of ['dnc20','dnc30-hd','dnc30-de']){
 const root=path.resolve('assets/unpacked/dnc',pack);
 const files=(await fs.readdir(root,{recursive:true})).filter(name=>/\.mdl$/i.test(String(name)));
 for(const relative of files){
  const file=path.join(root,relative),source=await fs.readFile(file,'utf8');
  const isUnit=/unit/i.test(path.basename(file))&&!/terrain|portrait/i.test(path.basename(file));
  if(isUnit){
   const result=renderDncLighting(source,file,'battle',3,{deMode:pack==='dnc30-de',isVersion30:pack!=='dnc20',...resolveUnitLightSettings({lighting:'battle',lightingAngle:230,shadowLength:0})});
   if(JSON.stringify(rotations(result))!==JSON.stringify(rotations(source)))unitsChanged++;
   continue;
  }
  for(const lighting of ['standard','battle','rpg','melee'])for(const brightness of [1,3,5])for(const lightingAngle of [0,230,360])for(const shadowLength of [0,50,100]){
   const result=renderDncLighting(source,file,lighting,brightness,{deMode:pack==='dnc30-de',isVersion30:pack!=='dnc20',...resolveUnitLightSettings({lighting,lightingAngle,shadowLength})});
   assert.deepEqual(rotations(result),rotations(source),`${pack}/${relative}/${lighting}/${brightness}/${lightingAngle}/${shadowLength}: non-unit Rotation must remain source-exact`);
   checked++;
  }
 }
}
assert(unitsChanged>0,'unit controls still change unit models');
console.log(`PASS: ${checked} profile/mode/brightness/direction/length cases preserve all non-unit rotations; ${unitsChanged} unit positive controls changed`);
