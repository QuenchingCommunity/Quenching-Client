export type UnitShadowLength = 'short' | 'long' | number;
export type UnitShadowSetting = UnitShadowLength | 'default';
/** Degrees above the horizon: keep a nonzero horizontal component even on short. */
export const UNIT_SHADOW_ELEVATION = Object.freeze({short:80,long:45});
export const UNIT_SHADOW_DEFAULT = 50;
export const UNIT_SHADOW_LONG_ELEVATION = 15;
export function validateUnitShadowLength(value:unknown):UnitShadowLength {
  if(value!=='short'&&value!=='long'&&!(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100))throw new Error('Invalid unit shadow length');
  return value;
}
/** Legacy short/long values remain valid; new sliders store a 0..100 position. */
export function unitShadowSliderValue(value:UnitShadowSetting):number {
  if(value==='default')return UNIT_SHADOW_DEFAULT;
  const length=validateUnitShadowLength(value);
  return length==='short'?0:length==='long'?100:length;
}
export function unitShadowElevation(value:UnitShadowLength,sourceElevation=45):number {
  const length=validateUnitShadowLength(value);
  if(length==='short'||length==='long')return UNIT_SHADOW_ELEVATION[length];
  return length<=UNIT_SHADOW_DEFAULT
    ? UNIT_SHADOW_ELEVATION.short+(sourceElevation-UNIT_SHADOW_ELEVATION.short)*length/UNIT_SHADOW_DEFAULT
    : sourceElevation+(UNIT_SHADOW_LONG_ELEVATION-sourceElevation)*(length-UNIT_SHADOW_DEFAULT)/UNIT_SHADOW_DEFAULT;
}
export function validateUnitShadowSetting(value:unknown):UnitShadowSetting {
  return value==='default'?value:validateUnitShadowLength(value);
}
export function resolveUnitLightSettings(settings:{lighting?:unknown;lightingAngle?:unknown;shadowLength?:unknown;rotatingLighting?:unknown}={}){
  if(settings.rotatingLighting===true)return {unitLightAngle:45,unitShadowLength:40 as UnitShadowLength,unitLightSourceDefaults:true};
  const battle=settings.lighting==='battle'||settings.lighting==='melee';
  const angle=typeof settings.lightingAngle==='number'&&Number.isFinite(settings.lightingAngle)&&settings.lightingAngle>=0&&settings.lightingAngle<=360?settings.lightingAngle:undefined;
  const validShadow=settings.shadowLength==='short'||settings.shadowLength==='long'||settings.shadowLength==='default'||
    (typeof settings.shadowLength==='number'&&Number.isFinite(settings.shadowLength)&&settings.shadowLength>=0&&settings.shadowLength<=100);
  const shadow=validShadow?settings.shadowLength as UnitShadowSetting:battle?20:UNIT_SHADOW_DEFAULT;
  const sourceDefaults=settings.lightingAngle===null||shadow==='default'||typeof shadow==='number';
  return {unitLightAngle:settings.lightingAngle===null?undefined:angle??(battle?230:undefined),
    unitShadowLength:shadow==='default'||shadow===UNIT_SHADOW_DEFAULT?undefined:shadow,
    ...(sourceDefaults?{unitLightSourceDefaults:true}:{}),};
}
/** Battle applies its defaults once; other mode changes preserve independent edits. */
export function unitLightModeDefaults<T extends {lighting?:unknown;lightingAngle?:number|null;shadowLength?:UnitShadowSetting;rotatingLighting?:boolean;atmosphericLight?:boolean}>(changes:T):T & {lightingAngle?:number|null;shadowLength?:UnitShadowSetting;rotatingLighting?:boolean;atmosphericLight?:boolean} {
  const battle=changes.lighting==='battle'||changes.lighting==='melee';
  if(!battle)return changes;
  return {...changes,lightingAngle:changes.lightingAngle===undefined?230:changes.lightingAngle,shadowLength:changes.shadowLength??20,
    rotatingLighting:changes.rotatingLighting??false,atmosphericLight:changes.atmosphericLight??false};
}
