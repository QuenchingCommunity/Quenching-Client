import type { PtrShaderCompatibility } from './ptr-shader-compatibility';
import type { SupportedWar3Version } from './war3-support';

export type VersionSelection = 'auto' | SupportedWar3Version;
export type GraphicsSelection = 'sd' | 'hd' | 'de';

export type EffectiveVersion = SupportedWar3Version;
export type EffectiveGraphics = 'sd' | 'hd' | 'de';

export type LightingSelection = 'standard' | 'battle' | 'rpg';

export interface ModProfileSelection {
  versionSelection: VersionSelection;
  graphicsSelection: GraphicsSelection;
}

export interface ModProfile extends ModProfileSelection {
  version: EffectiveVersion;
  graphics: EffectiveGraphics;
  usesPublicEnvironment: boolean;
  shaderPack: 'shaders203' | 'shaders-300-hd' | 'shaders-300-de' | 'shaders-ptr-hd' | 'shaders-ptr-de' | 'shaders-300-legacy-hd' | 'shaders-300-legacy-de';
  dncPack: 'dnc20' | 'dnc30-hd' | 'dnc30-de' | 'dnc30-de-rpg';
  /** PTR is independently verified; never infer its shader ABI from a UI choice. */
  ptrShaderCompatibility?: PtrShaderCompatibility;
}

export function assertShaderProfileSupported(profile: Pick<ModProfile, 'graphics' | 'ptrShaderCompatibility'>): void {
  if (profile.graphics !== 'sd' && profile.ptrShaderCompatibility?.status === 'unverified') {
    const version = profile.ptrShaderCompatibility.detectedVersion || 'unknown';
    throw new Error(`PTR ${version}: shader compatibility is not verified. Disable MOD or update the client. / 着色器尚未验证，请关闭 MOD 或更新客户端。`);
  }
}

export const DEFAULT_MOD_PROFILE_SELECTION: ModProfileSelection = {
  versionSelection: 'auto',
  graphicsSelection: 'hd',
};

export function isHdGraphics(graphics: EffectiveGraphics): boolean {
  return graphics === 'hd' || graphics === 'de';
}

export function canUseRetroSkin(graphics: EffectiveGraphics): boolean {
  return graphics === 'hd';
}

export function isVersion30OrLater(version: unknown): boolean {
  return version === 'v30' || version === 'v301';
}

export function isHdShaderPack(pack: ModProfile['shaderPack']): boolean {
  return pack === 'shaders-300-hd' || pack === 'shaders-ptr-hd' || pack === 'shaders-300-legacy-hd';
}

export function normalizeVersionSelection(value: unknown): VersionSelection {
  // The old combined 2.03–2.04 preference maps to 2.04. Actual 2.03
  // installations are still rejected by the detected-version policy.
  if (value === 'v203') return 'v204';
  // 3.0 keeps its own shader ABI; newer enhancements are gated separately.
  return value === 'v204' || value === 'v30' || value === 'v301' || value === 'auto'
    ? value
    : 'auto';
}

export function normalizeGraphicsSelection(value: unknown): GraphicsSelection {
  return value === 'sd' || value === 'hd' || value === 'de'
    ? value
    : 'hd';
}
