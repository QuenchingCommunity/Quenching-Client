import { resourcePath } from '../../shared/bundled-resource-paths.mjs';
import path from 'node:path';
import type { EffectiveGraphics, EffectiveVersion } from '../../shared/mod-profile';
import { skinEraForVersion } from './unit-skin-profile';

/** Keep the 2.x destructable table separate from the 3.0 table, as with unitskin. */
export function destructableSkinTemplate(
  quenchingDir: string,
  graphics: EffectiveGraphics,
  version: EffectiveVersion,
  treeMode: string,
): string {
  const name = graphics === 'de' ? 'destructableskin-de.txt'
    : treeMode === 'original' ? 'destructableskin.txt' : 'destructableskin-org.txt';
  return resourcePath(quenchingDir, 'skin', ...(skinEraForVersion(version) === 'v20' ? ['legacy'] : []), name);
}
