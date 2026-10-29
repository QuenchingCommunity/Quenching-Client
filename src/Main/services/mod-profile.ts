import { resourcePath } from '../../shared/bundled-resource-paths.mjs';
import path from 'path';
import {
  DEFAULT_MOD_PROFILE_SELECTION,
  EffectiveGraphics,
  EffectiveVersion,
  ModProfile,
  ModProfileSelection,
  VersionSelection,
  normalizeGraphicsSelection,
  normalizeVersionSelection,
  isVersion30OrLater,
  isHdShaderPack,
  assertShaderProfileSupported,
} from '../../shared/mod-profile';
import { resolvePtrShaderCompatibility } from '../../shared/ptr-shader-compatibility';
import { shaderMaterialMode } from '../../shared/shader-variant';
import { detectWar3Version } from './war3-version';
import { getSelectedGameChannel } from './game-channel';
import { assertWar3VersionSupported } from '../../shared/war3-support';

export type ResourcePathKey =
  | 'dnc20'
  | 'dnc30Hd'
  | 'dnc30De'
  | 'dnc30DeRpg'
  | 'shaders203'
  | 'shaders300Hd'
  | 'shaders300De'
  | 'shadersPtrHd'
  | 'shadersPtrDe'
  | 'shaders300LegacyHd'
  | 'shaders300LegacyDe'
  | 'environmentPublic'
  | 'skin';

function versionFromSelection(selection: VersionSelection, detected: EffectiveVersion): EffectiveVersion {
  return selection === 'auto' ? detected : selection;
}

export async function resolveModProfile(
  war3Path: string,
  selection?: Partial<ModProfileSelection> & { classicMode?: boolean; lighting?: string }
): Promise<ModProfile> {
  const detected = await detectWar3Version(war3Path);
  const versionSelection = normalizeVersionSelection(selection?.versionSelection ?? DEFAULT_MOD_PROFILE_SELECTION.versionSelection);
  const graphicsSelection = normalizeGraphicsSelection(selection?.graphicsSelection ?? DEFAULT_MOD_PROFILE_SELECTION.graphicsSelection);
  // A manual resource choice cannot authorize an unsupported installed build.
  // If metadata cannot be read, an explicit supported choice remains usable.
  const detectedVersion = detected.source === 'unknown' && versionSelection !== 'auto'
    ? versionSelection : assertWar3VersionSupported(detected);
  const isPtr = getSelectedGameChannel() === 'ptr';
  const ptrShaderCompatibility = isPtr ? resolvePtrShaderCompatibility(detected) : undefined;
  // PTR always uses the latest logical skin/DNC tier, never a stale 2.x reading.
  // This tier is NOT shader-ABI permission: the separate exact-build gate below
  // must authorize every shader write and MOD launch, including manual choices.
  const version = isPtr ? 'v301'
    : versionFromSelection(versionSelection, detectedVersion);
  let graphics: EffectiveGraphics = selection?.classicMode === true ? 'sd' : graphicsSelection;

  // A saved DE choice must not silently install 3.0 shaders into a 2.x game.
  if (graphics === 'de' && !isVersion30OrLater(version)) {
    graphics = 'hd';
  }

  const is3 = isVersion30OrLater(version);
  const isDe = is3 && graphics === 'de';
  // The material variant is selected independently of the version-specific pack.
  const shaderPack = isPtr
    ? (isDe ? 'shaders-ptr-de' : 'shaders-ptr-hd')
    : version === 'v30'
    ? (isDe ? 'shaders-300-legacy-de' : 'shaders-300-legacy-hd')
    : is3
    ? (isDe ? 'shaders-300-de' : 'shaders-300-hd')
    : 'shaders203';
  const dncPack = is3 ? (isDe ? 'dnc30-de' : 'dnc30-hd') : 'dnc20';

  return {
    versionSelection,
    graphicsSelection,
    version,
    graphics,
    usesPublicEnvironment: !isDe,
    shaderPack,
    dncPack,
    ...(ptrShaderCompatibility ? { ptrShaderCompatibility } : {}),
  };
}

export function getQuenchingResourcePath(quenchingDir: string, key: ResourcePathKey): string {
  const paths: Record<ResourcePathKey, string> = {
    dnc20: resourcePath(quenchingDir, 'dnc', 'dnc20'),
    dnc30Hd: resourcePath(quenchingDir, 'dnc', 'dnc30-hd'),
    dnc30De: resourcePath(quenchingDir, 'dnc', 'dnc30-de'),
    dnc30DeRpg: resourcePath(quenchingDir, 'dnc', 'dnc30-de-rpg'),
    shaders203: resourcePath(quenchingDir, 'shaders', 'shaders203'),
    shaders300Hd: resourcePath(quenchingDir, 'shaders', 'shaders-300-hd'),
    shaders300De: resourcePath(quenchingDir, 'shaders', 'shaders-300-de'),
    shadersPtrHd: resourcePath(quenchingDir, 'shaders', 'shaders-ptr-hd'),
    shadersPtrDe: resourcePath(quenchingDir, 'shaders', 'shaders-ptr-de'),
    shaders300LegacyHd: resourcePath(quenchingDir, 'shaders', 'shaders-300-legacy-hd'),
    shaders300LegacyDe: resourcePath(quenchingDir, 'shaders', 'shaders-300-legacy-de'),
    environmentPublic: path.join(quenchingDir, 'env-20-30-public.zip'),
    skin: resourcePath(quenchingDir, 'skin'),
  };
  return paths[key];
}

export function getShaderResourcePath(quenchingDir: string, profile: ModProfile, lighting: string = 'standard'): string {
  assertShaderProfileSupported(profile);
  const root = getQuenchingResourcePath(quenchingDir, profile.shaderPack === 'shaders-300-legacy-hd'
    ? 'shaders300LegacyHd'
    : profile.shaderPack === 'shaders-300-legacy-de'
    ? 'shaders300LegacyDe'
    : profile.shaderPack === 'shaders203'
        ? 'shaders203'
        : profile.shaderPack === 'shaders-300-de'
          ? 'shaders300De'
          : profile.shaderPack === 'shaders-ptr-de'
            ? 'shadersPtrDe'
            : profile.shaderPack === 'shaders-ptr-hd'
              ? 'shadersPtrHd'
              : 'shaders300Hd');
  if (isHdShaderPack(profile.shaderPack)) {
    const effective = effectiveLightingMode(profile, lighting);
    // Modern HD ships independently derived Standard, Battle and RPG materials.
    const folder = shaderMaterialMode(profile, effective);
    return path.join(root, 'ps', folder);
  }
  if (['shaders-300-de', 'shaders-ptr-de'].includes(profile.shaderPack) && lighting === 'battle') return path.join(root, 'battle');
  return root;
}

export function getShaderPackRoot(quenchingDir: string, profile: Pick<ModProfile, 'shaderPack'>): string {
  return resourcePath(quenchingDir, 'shaders', profile.shaderPack);
}

/** DE RPG shares its current Standard material and DNC. */
export function effectiveLightingMode(profile: ModProfile, lighting: string = 'standard'): string {
  return (lighting === 'rpg' && profile.graphics === 'de') || profile.dncPack === 'dnc30-de-rpg' ? 'standard' : lighting;
}

export function getDncResourcePath(quenchingDir: string, profile: ModProfile): string {
  const keys: Record<ModProfile['dncPack'], ResourcePathKey> = {
    'dnc20': 'dnc20',
    'dnc30-hd': 'dnc30Hd',
    'dnc30-de': 'dnc30De',
    'dnc30-de-rpg': 'dnc30DeRpg',
  };
  return getQuenchingResourcePath(quenchingDir, keys[profile.dncPack]);
}

export function getKnownDncRoots(quenchingDir: string): Array<{ source: string }> {
  return (['dnc20', 'dnc30Hd', 'dnc30De', 'dnc30DeRpg'] as const)
    .map((key) => ({ source: getQuenchingResourcePath(quenchingDir, key) }));
}

export function getSelectedShaderLabel(profile: ModProfile): string {
  return profile.shaderPack;
}
