import fs from 'fs-extra';
import path from 'node:path';
import type { ModProfile } from '../../shared/mod-profile';
import { resourcePath } from '../../shared/bundled-resource-paths.mjs';
import { ensureResourceSelection } from './bundled-assets';
import { shaderToggleResourcePaths } from './fog-shader-override';
import { shaderPixelFolder } from '../../shared/shader-variant';

export interface ShaderBundleSelection {
  files?: string[];
  prefixes?: string[];
}

/** Select the active variant and its dependencies before extracting any bytes. */
export function selectShaderBundleResources(
  profile: Pick<ModProfile, 'graphics' | 'shaderPack' | 'ptrShaderCompatibility'>,
  settings: any,
  effectFiles?: string[],
): ShaderBundleSelection {
  const root = `shaders/${profile.shaderPack}/`;
  const pixel = shaderPixelFolder(profile, settings?.lighting);
  const sourcePath = (file: string) => root + (file.startsWith('ps/') ? `${pixel}/${file.slice(3)}` : file);
  return {
    files: [...new Set([...shaderToggleResourcePaths(profile, settings), ...(effectFiles || []).map(sourcePath)])],
    prefixes: effectFiles ? [] : [`${root}${pixel}/`, `${root}vs/`],
  };
}

/** Reuse the startup-prepared resource directory. No per-switch ZIP expansion. */
export async function withShaderBundle<T>(
  quenchingDir: string,
  pack: ModProfile['shaderPack'],
  stagingParent: string,
  action: (shaderQuenchingDir: string) => Promise<T>,
  selection?: ShaderBundleSelection,
  onProgress?: (percent: number, name: string) => void,
): Promise<T> {
  const fog = pack.includes('-legacy-') ? 'fog_shaders-legacy' : 'fog_shaders';
  await ensureResourceSelection(quenchingDir, selection
    ? [...(selection.files || []), ...(selection.prefixes || [])]
    : [`shaders/${pack}/`, `shaders/${fog}/`, ...(pack.startsWith('shaders-ptr-') ? ['shaders/fog_shaders-ptr/'] : []), 'shaders/readability-301/']);
  if ((!selection || selection.files?.length || selection.prefixes?.length) && !await fs.pathExists(resourcePath(quenchingDir, 'shaders', pack))) throw new Error(`Shader resources do not contain ${pack}`);
  onProgress?.(100, pack);
  return action(quenchingDir);
}
