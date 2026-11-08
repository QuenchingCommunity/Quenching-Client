import type { ModProfile } from './mod-profile';
import {defaultHdrExposure} from './hdr-exposure';
import {resolveUnitLightSettings,unitShadowSliderValue} from './unit-light-settings';

export type RenderingPreset = 'standard' | 'battle';
export function renderingPresetSettings(preset: RenderingPreset) {
  const battle = preset === 'battle';
  return {
    lighting: battle ? 'battle' as const : 'standard' as const,
    lightingAngle: battle ? 230 : 45,
    shadowLength: battle ? 20 : 50,
    ...(battle?{rotatingLighting:false,atmosphericLight:false}:{}),
    hdrExposure: defaultHdrExposure(battle ? 'battle' : 'standard'),
    lightingBrightness: battle ? 4 as const : 3 as const,
    tree: battle ? 'v16' as const : 'tall' as const,
    terrain: battle ? 'v16' as const : 'latest' as const,
    objectShader: true, postProcessing: true, postProcessingGlow: true,
    postProcessingOutline: battle, improveReadability: battle,
    volumetricFog: true, foliage: true, blight: true, glow: !battle,
  };
}

export function matchesRenderingPreset(settings: object, preset: RenderingPreset): boolean {
  const saved=settings as {lightingAngle?:unknown;shadowLength?:unknown};
  if(saved.lightingAngle===null||saved.shadowLength==='default')return false;
  const direction=resolveUnitLightSettings(settings);
  const shadow=direction.unitShadowLength===undefined?50:unitShadowSliderValue(direction.unitShadowLength);
  const values={...settings,lightingAngle:direction.unitLightAngle??45,shadowLength:shadow===0?'short':shadow===100?'long':shadow};
  return Object.entries(renderingPresetSettings(preset)).every(([key, value]) => (values as Record<string, unknown>)[key] === value);
}

export function supportsReadability(profile: Pick<ModProfile, 'graphics' | 'shaderPack'>): boolean {
  const packs = profile.graphics === 'hd' ? ['shaders-300-hd', 'shaders-ptr-hd']
    : profile.graphics === 'de' ? ['shaders-300-de', 'shaders-ptr-de'] : [];
  return packs.includes(profile.shaderPack);
}

export function readabilityEnabled(settings: { improveReadability?: unknown; objectShader?: unknown; postProcessing?: unknown } = {}): boolean {
  return settings.improveReadability === true && settings.objectShader !== false && settings.postProcessing !== false;
}
