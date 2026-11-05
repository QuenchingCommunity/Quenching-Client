// Publisher-side channel selection. Does not start Electron or contact a website.
import fs from 'node:fs/promises';
import path from 'node:path';

export const PORTABLE_TEST_MARKER = 'quenching-update-test.json';
const testState = new Set(['.test-config', '.test-user-data', 'README-TEST.txt', 'start-update-test.cmd']);

export function isPortableRuntimePath(relative) {
  return /^(?:unpacked|_tmp)(?:\/|$)/i.test(relative.replaceAll('\\', '/'));
}

/** Local test selection/configuration must never enter a signed file inventory. */
export function isPortableTestOnlyPath(relative) {
  const top = relative.replaceAll('\\', '/').split('/')[0].toLowerCase();
  return top === PORTABLE_TEST_MARKER || [...testState].some(name => name.toLowerCase() === top);
}

export function portableTestMarker(baseUrl) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) throw new Error('A test portable requires an explicit --test-base');
  const base = baseUrl.trim();
  const url = new URL(base);
  const loopback = url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if ((url.protocol !== 'https:' && !loopback) || url.username || url.password || url.search || url.hash ||
      !base.endsWith('/') || (!loopback && !url.pathname.startsWith('/quenching/update-test/'))) {
    throw new Error('Test base must be a dedicated HTTPS /quenching/update-test/ directory (or an isolated loopback fixture)');
  }
  return { schema: 1, enabled: true, baseUrl: base };
}

/** Test is the default. Production is explicit and rejects test installation state. */
export async function preparePortableChannel(root, { channel = 'test', baseUrl } = {}) {
  if (channel !== 'test' && channel !== 'production') throw new Error('Unknown portable channel');
  if (channel === 'production' && baseUrl !== undefined) throw new Error('Production export cannot specify --test-base');
  const markerValue = channel === 'test' ? portableTestMarker(baseUrl) : undefined;
  const exe = await fs.lstat(path.join(root, 'QMClient.exe'));
  if (!exe.isFile() || exe.isSymbolicLink()) throw new Error('Expected an ordinary Windows portable QMClient.exe');
  for (const name of [...testState, '.quenching-client-update', 'unpacked', '_tmp']) {
    if (await fs.lstat(path.join(root, name)).catch(error => { if (error.code !== 'ENOENT') throw error; return null; })) {
      throw new Error(`Export a fresh build, not a used test installation: ${name}`);
    }
  }
  const marker = path.join(root, PORTABLE_TEST_MARKER);
  const previous = await fs.lstat(marker).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (channel === 'production') {
    if (previous) throw new Error('Production build still contains quenching-update-test.json');
    return { channel, marker: null };
  }
  if (previous) {
    if (!previous.isFile() || previous.isSymbolicLink()) throw new Error('Invalid portable test marker');
    const value = JSON.parse(await fs.readFile(marker, 'utf8'));
    if (value.schema !== 1 || value.enabled !== true || value.baseUrl !== markerValue.baseUrl) {
      throw new Error('Existing test marker differs; do not silently change a candidate channel');
    }
  } else {
    await fs.writeFile(marker, JSON.stringify(markerValue, null, 2) + '\n', { flag: 'wx' });
  }
  return { channel, marker: markerValue };
}
