import { resourcePath } from '../../shared/bundled-resource-paths.mjs';
import fs from 'fs-extra';
import path from 'path';

export type ModWaterMode = 'transparent' | 'realistic';

export async function verifyWaterModeAssets(assetsDir: string, mode: ModWaterMode): Promise<void> {
  const waterRoot = resourcePath(path.join(assetsDir, 'quenching'), 'water');
  const tileRoot = resourcePath(path.join(assetsDir, 'quenching'), 'tile');
  const sourceWater = path.join(waterRoot, mode === 'transparent' ? 'water-trans' : 'water-rel');
  const shorelineNames = mode === 'transparent' ? ['shoreline1.dds', 'shorelineparticlexy.dds'] : [];
  const sources = [sourceWater,
    ...(mode === 'transparent' ? [path.join(tileRoot, 'water-trans.slk')] : []),
    ...shorelineNames.map((name) => path.join(waterRoot, 'shoreline', name))];
  for (const source of sources) {
    if (!(await fs.pathExists(source))) throw new Error(`Missing bundled water resource: ${source}`);
  }
}

/** Client assets are immutable templates: never move or remove these sources. */
export async function copyWaterModeFromAssets(baseDir: string, assetsDir: string, mode: ModWaterMode): Promise<void> {
  await verifyWaterModeAssets(assetsDir, mode);
  const waterRoot = resourcePath(path.join(assetsDir, 'quenching'), 'water');
  const tileRoot = resourcePath(path.join(assetsDir, 'quenching'), 'tile');
  const sourceWater = path.join(waterRoot, mode === 'transparent' ? 'water-trans' : 'water-rel');
  const shorelineNames = mode === 'transparent' ? ['shoreline1.dds', 'shorelineparticlexy.dds'] : [];

  const waterTarget = path.join(baseDir, 'replaceabletextures', 'water');
  const slkTarget = path.join(baseDir, 'terrainart', 'water.slk');
  await fs.copy(sourceWater, waterTarget, { overwrite: false, errorOnExist: true });
  // Only transparent water overrides the table's RGB colors. Other modes
  // keep Warcraft's native water table, including its HD/DE-specific values.
  if (mode === 'transparent') {
    await fs.copy(path.join(tileRoot, 'water-trans.slk'), slkTarget, { overwrite: false, errorOnExist: true });
  } else {
    await fs.remove(slkTarget);
  }
  for (const name of shorelineNames) {
    await fs.copy(path.join(waterRoot, 'shoreline', name), path.join(baseDir, 'textures', name), { overwrite: false, errorOnExist: true });
  }
}
