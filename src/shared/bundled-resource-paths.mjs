import fs from 'node:fs';
import path from 'node:path';

export const UNPACKED_RESOURCE_DIRS = Object.freeze(['camp', 'dnc', 'experimental', 'shaders', 'skin', 'tile', 'tx', 'water']);
export const RESOURCE_ARCHIVE = 'resources.7z';
export const RESOURCE_ARCHIVES = Object.freeze(['resources-core.7z', 'resources-ui.7z', 'resources-terrain.7z',
  'resources-foliage-color.7z', 'resources-foliage-detail.7z']);
export const RESOURCE_MANIFEST = 'resources.manifest.json';
/** Fixed semantic routing: never rebalance existing files when their sizes change. */
export function resourceArchiveFor(name) {
  if (name.startsWith('packages/zip-ui-') || name.startsWith('tx/') || name === 'TrajanPro3-Regular.otf') return 'resources-ui.7z';
  if (name.startsWith('packages/zip-blight-') || name.startsWith('tile/')) return 'resources-terrain.7z';
  if (name.startsWith('packages/zip-foliage-')) {
    return /normal|spec|rough|metal|orm|occl|mask|(?:_|-)n(?:om)?(?:\.|_)|(?:_|-)o(?:\.|_)/i.test(name.split('/').at(-1))
      ? 'resources-foliage-detail.7z' : 'resources-foliage-color.7z';
  }
  return 'resources-core.7z';
}
export function resourceArchiveDescriptors(manifest) {
  return manifest.schema === 3 ? Object.values(manifest.archives) : [manifest.archive];
}
export const BOOTSTRAP_ASSETS = Object.freeze(['ui-misc.txt', '1.ico', 'logo.png', 'update-public-key.pem', 'index.html', 'local-release.json', 'PostProcessingConfig.txt', 'update-baselines']);
const prepared = new Map();
// Restore independent PTR sources and set true when a future verified ABI needs them.
export const PTR_INDEPENDENT_SHADERS = false;
export function resourceSourceAlias(relative) {
  return PTR_INDEPENDENT_SHADERS ? relative : relative.replace(/(^|\/)shaders-ptr-(hd|de)(?=\/|$)/g, '$1shaders-300-$2');
}
export function isDistributableAsset(relative) {
  const parts = relative.replaceAll('\\', '/').split('/');
  if(parts.some(part=>part.toLowerCase()==='offline.exe'))return false;
  if (['unpacked', 'backup'].includes(parts[0])) return false;
  if (parts[0] !== 'quenching' || parts.length === 1) return true;
  return BOOTSTRAP_ASSETS.includes(parts[1]) || [...RESOURCE_ARCHIVES, RESOURCE_MANIFEST].includes(parts[1]);
}

export function registerResourceRoot(quenchingDir, resourceRoot) {
  prepared.set(path.resolve(quenchingDir), path.resolve(resourceRoot));
}

/** Static assets stay in quenching; expanded resources use the prepared local cache. */
export function resourcePath(quenchingDir, ...parts) {
  parts = resourceSourceAlias(parts.join('/')).split('/');
  const first = parts[0]?.split(/[\\/]/)[0];
  if (BOOTSTRAP_ASSETS.includes(first) || /\.zip$/i.test(first || '')) return path.join(quenchingDir, ...parts);
  const selected = prepared.get(path.resolve(quenchingDir));
  if (selected) return path.join(selected, ...parts);
  const source = path.resolve(quenchingDir, '..', 'unpacked');
  if (fs.existsSync(path.join(source, first))) return path.join(source, ...parts);
  // Isolated tests and older development layouts can supply loose fixtures.
  return path.join(quenchingDir, ...parts);
}
