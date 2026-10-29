import { isHdShaderPack } from './mod-profile';
import type { ModProfile } from './mod-profile';

export function shaderMaterialMode(profile: Pick<ModProfile, 'shaderPack'>, lighting: unknown): 'standard' | 'melee' | 'rpg' {
  if (profile.shaderPack.endsWith('-de')) return 'melee';
  if (lighting === 'battle') return 'melee';
  if (lighting === 'rpg' && ['shaders-300-hd', 'shaders-ptr-hd'].includes(profile.shaderPack)) return 'rpg';
  return 'standard';
}

export function shaderPixelFolder(profile: Pick<ModProfile, 'shaderPack'>, lighting: unknown): string {
  if (isHdShaderPack(profile.shaderPack)) return `ps/${shaderMaterialMode(profile, lighting)}`;
  if (['shaders-300-de', 'shaders-ptr-de'].includes(profile.shaderPack) && lighting === 'battle') return 'battle/ps';
  return 'ps';
}

export function readabilityProfileKey(profile: Pick<ModProfile, 'graphics' | 'shaderPack'>, lighting: unknown, fogVariant: string): string {
  if (profile.graphics === 'de') return `de_${fogVariant}`;
  return shaderMaterialMode(profile, lighting) === 'rpg' ? `rpg_${fogVariant}` : fogVariant;
}
