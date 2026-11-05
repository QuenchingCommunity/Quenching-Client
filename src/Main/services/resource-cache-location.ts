import path from 'node:path';

/** Expanded resources travel with the portable client, never with the user profile. */
export function resourceCacheLocation(packaged: boolean, executable: string, assets: string, platform = process.platform) {
  let base = packaged ? path.dirname(executable) : path.join(path.dirname(assets), '_tmp', 'runtime-resources');
  // Keep writable resources outside a signed macOS app bundle.
  if (packaged && platform === 'darwin' && path.basename(base) === 'MacOS' &&
      path.basename(path.dirname(base)) === 'Contents' && path.dirname(path.dirname(base)).endsWith('.app')) {
    base = path.resolve(base, '../../..');
  }
  return { cacheBase: base, flatCache: true, sharedCache: true, verification: 'light' as const };
}
