import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import {vec3} from 'gl-matrix';
import {lightQuaternionForShadow,lightQuaternionAtAzimuth,buildRotatingLightTrack} from '../src/shared/dnc-rotation';
import {UNIT_SHADOW_ELEVATION,unitShadowElevation,unitShadowSliderValue,resolveUnitLightSettings,unitLightModeDefaults,validateUnitShadowLength} from '../src/shared/unit-light-settings';
import {renderingPresetSettings,matchesRenderingPreset} from '../src/shared/rendering-presets';
import {visionBlocksSetting} from '../src/shared/vision-modules';
import rotations from '../assets/unpacked/experimental/de-unit-rotations.json';
import {patchRotatingUnitLighting,replaceUnitRotation,unitRotationBlock} from '../src/Main/services/rotating-lighting';
const vector=(q:readonly number[])=>vec3.transformQuat([0,0,0] as any,[0,0,1],q as any);
const near=(a:number,b:number)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const elevation=(q:readonly number[])=>Math.asin(vector(q)[2])*180/Math.PI;
const expectedShadow=(value:'short'|'long'|number,native:number)=>typeof value!=='number'?UNIT_SHADOW_ELEVATION[value]:value<=50?80+(native-80)*value/50:native+(15-native)*(value-50)/50;
const raw=[.25,.25,.7,0],nativeElevation=elevation(raw.map(v=>v/Math.hypot(...raw)));
const nativeTrack=buildRotatingLightTrack(rotations.keyframes,rotations.interval,[0,60000]);
for(const length of ['short','long',0,25,50,75,100] as const)for(const angle of [0,45,90,180,230,360]){
 const expectedElevation=expectedShadow(length,nativeElevation);
 const q=lightQuaternionAtAzimuth(lightQuaternionForShadow([.25,.25,.7,0],length),angle),d=vector(q);
 near(Math.hypot(...q),1);near(elevation(q),expectedElevation);
 near(Math.atan2(Math.sin(Math.atan2(d[1],d[0])-angle*Math.PI/180),Math.cos(Math.atan2(d[1],d[0])-angle*Math.PI/180)),0);
 const ratio=Math.hypot(d[0],d[1])/d[2];assert(ratio>.1,'short retains a visible shadow');
 near(ratio,1/Math.tan(expectedElevation*Math.PI/180));
 const track=buildRotatingLightTrack(rotations.keyframes,rotations.interval,[0,60000],angle,length);
 for(const [index,key]of track.entries())near(elevation(key.value),expectedShadow(length,elevation(nativeTrack[index].value)));
 assert.deepEqual(track.at(-1)!.value,track[0].value);
 const anchor=vector(track.find(k=>k.frame===15000)!.value);
 near(Math.atan2(Math.sin(Math.atan2(anchor[1],anchor[0])-angle*Math.PI/180),Math.cos(Math.atan2(anchor[1],anchor[0])-angle*Math.PI/180)),0);
}
for(const value of [null,undefined,-1,101,NaN,Infinity,true,'medium','SHORT','50'])assert.throws(()=>validateUnitShadowLength(value));
assert.equal(unitShadowSliderValue('short'),0);assert.equal(unitShadowSliderValue('long'),100);assert.equal(unitShadowSliderValue('default'),50);
assert.deepEqual(resolveUnitLightSettings({}),{unitLightAngle:60,unitShadowLength:undefined,unitLightSourceDefaults:true},'missing normal setting uses 60 degrees and native shadow at 50%');
for(const lighting of ['standard','rpg','enhanced']){
 assert.equal(resolveUnitLightSettings({lighting}).unitLightAngle,60);
 assert.equal(unitLightModeDefaults({lighting}).lightingAngle,60);
 assert.equal(unitLightModeDefaults({lighting,lightingAngle:null}).lightingAngle,null);
 assert.equal(unitLightModeDefaults({lighting,lightingAngle:90}).lightingAngle,90);
}
assert.equal(renderingPresetSettings('standard').lightingAngle,60);
assert.deepEqual(resolveUnitLightSettings({shadowLength:50}),resolveUnitLightSettings({shadowLength:'default'}),'50% and reset use identical raw DNC parameters');
assert.equal(resolveUnitLightSettings({shadowLength:37}).unitShadowLength,37);
assert.deepEqual(resolveUnitLightSettings({lighting:'battle'}),{unitLightAngle:230,unitShadowLength:20,unitLightSourceDefaults:true});
assert.deepEqual(resolveUnitLightSettings({lighting:'battle',lightingAngle:null,shadowLength:'default'}),
 {unitLightAngle:undefined,unitShadowLength:undefined,unitLightSourceDefaults:true},'explicit reset survives battle fallback');
assert.equal(unitLightModeDefaults({lighting:'battle',lightingAngle:null,shadowLength:'default' as const}).lightingAngle,null);
assert.equal(unitLightModeDefaults({lighting:'battle'}).lightingAngle,230);
assert.deepEqual(unitLightModeDefaults({lighting:'battle',lightingAngle:90,shadowLength:'long' as const}),{lighting:'battle',lightingAngle:90,shadowLength:'long',rotatingLighting:false,atmosphericLight:false});
const battle=renderingPresetSettings('battle');assert.equal(battle.shadowLength,20);assert.equal(battle.lightingAngle,230);
assert.equal(battle.rotatingLighting,false);assert.equal(battle.atmosphericLight,false);
assert.equal(renderingPresetSettings('standard').shadowLength,50);
assert(matchesRenderingPreset(battle,'battle'));assert(!matchesRenderingPreset({...battle,shadowLength:'long'},'battle'));
assert(!matchesRenderingPreset({...battle,shadowLength:0},'battle'),'old shortest is different from the current 20% preset');
const legacy={...battle} as any;delete legacy.shadowLength;delete legacy.lightingAngle;
assert(matchesRenderingPreset(legacy,'battle'),'legacy battle presets use the new direction defaults');
assert(visionBlocksSetting({visionMiscShaders:true},'shadowLength'));
const parent=path.resolve('_tmp/shadow-default50-20261108');await fs.ensureDir(parent);const root=await fs.mkdtemp(path.join(parent,'files-'));
async function snapshot(dir:string){const result=new Map<string,string>();for(const name of await fs.readdir(dir,{recursive:true})){const file=path.join(dir,name);if((await fs.lstat(file)).isFile())result.set(String(name).replaceAll('\\','/'),await fs.readFile(file,'utf8'));}return result;}
const strip=(s:string)=>replaceUnitRotation(s,'ROTATION');
let scenarios=0;
try{
 for(const pack of ['dnc20','dnc30-hd','dnc30-de'])for(const mode of ['standard','battle'])for(const rotating of [false,true]){
  const baseline=path.resolve('assets/unpacked/dnc',pack),dnc=path.join(root,pack,mode,String(rotating));await fs.copy(baseline,dnc);
  await fs.outputFile(path.join(dnc,'custom/customunit.mdl'),'player custom model');await fs.outputFile(path.join(dnc,'NELonstar/keep.txt'),'player extra folder');
  const before=await snapshot(dnc);
  for(const length of ['short','long',37] as const){
   const options={deMode:pack==='dnc30-de',isVersion30:pack!=='dnc20',...resolveUnitLightSettings({lighting:mode,lightingAngle:230,shadowLength:length})};
   await patchRotatingUnitLighting(dnc,baseline,rotating,mode,3,options,undefined,true);
   const after=await snapshot(dnc);
   for(const [name,content]of before){
    const actual=after.get(name)!;
    if(/unit[^/]*\.mdl$/i.test(name)&&!/(terrain|portrait|custom)/i.test(name)){
     assert.equal(strip(actual),strip(content),`${name}: only Rotation can change`);
     const keys=[...unitRotationBlock(actual).matchAll(/\d+:\s*\{\s*([^}]+)\}/g)];assert(keys.length);
     for(const key of keys){const actualElevation=elevation(key[1].split(',').map(Number));
      if(rotating&&Object.keys(rotations.sources).includes(name)){assert(actualElevation>=15&&actualElevation<=80);continue;}
      if(typeof length!=='number')near(actualElevation,unitShadowElevation(length));
      else if(!rotating||!Object.keys(rotations.sources).includes(name)){
       const sourceKeys=[...unitRotationBlock(content).matchAll(/(\d+):\s*\{\s*([^}]+)\}/g)];
       const frame=key[0].split(':')[0].trim(),sourceKey=sourceKeys.find(k=>k[1]===frame)??sourceKeys[0];
       const sourceValue=sourceKey[2].split(',').map(Number),native=elevation(sourceValue.map(v=>v/Math.hypot(...sourceValue)));
       near(actualElevation,expectedShadow(length,native));
      }else assert(actualElevation>=15&&actualElevation<=80,'numeric rotating shadow remains in range');
     }
    }else assert.equal(actual,content,`${name}: terrain, portrait, custom files preserved`);
   }
   await patchRotatingUnitLighting(dnc,baseline,rotating,mode,3,options,undefined,true);
   assert.deepEqual(await snapshot(dnc),after,'repeated selection is idempotent');scenarios++;
  }
  const stable=await snapshot(dnc);
  await assert.rejects(patchRotatingUnitLighting(dnc,baseline,rotating,mode,3,{unitLightAngle:45,unitShadowLength:'short',deMode:pack==='dnc30-de',isVersion30:pack!=='dnc20'},()=>{throw Error('commit failed');},true),/commit failed/);
  assert.deepEqual(await snapshot(dnc),stable,'failed preference commit rolls back every unit quaternion');
  // Reset each axis independently, then both, using the original source for every pack/mode.
  const resetOptions={deMode:pack==='dnc30-de',isVersion30:pack!=='dnc20',...resolveUnitLightSettings({lighting:mode,lightingAngle:null,shadowLength:'default'})};
  await patchRotatingUnitLighting(dnc,baseline,rotating,mode,3,resetOptions,undefined,true);
  for(const [name,original]of before){
   const actual=await fs.readFile(path.join(dnc,name),'utf8');
   if(/unit[^/]*\.mdl$/i.test(name)&&!/(terrain|portrait|custom)/i.test(name)){
    assert.equal(strip(actual),strip(original),'reset only touches unit Rotation');
    if(!rotating||!Object.keys(rotations.sources).includes(name))assert.equal(unitRotationBlock(actual).replaceAll('\r\n','\n'),unitRotationBlock(original).replaceAll('\r\n','\n'),`${pack}/${mode}/${name}: raw source rotation restored`);
    else assert.equal([...unitRotationBlock(actual).matchAll(/\d+:\s*\{/g)].length,97,'rotating reset retains the locked campaign track');
   }else assert.equal(actual,original,'reset preserves terrain, portrait and custom files');
  }
 }
 console.log(`PASS: short=80deg/nonzero shadow, long=45deg, independent azimuth, rotating track, battle=230/20%, ${scenarios} file scenarios, unit-only bytes, custom folders, idempotence and rollback`);
}finally{assert.equal(path.dirname(root),parent);await fs.remove(root);}
