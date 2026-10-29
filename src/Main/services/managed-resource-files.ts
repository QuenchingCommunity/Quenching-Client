import path from 'node:path';
import fs from 'fs-extra';

export interface BundledResourceRoot {
  source: string;
  targetPrefix?: string;
}

export interface ResourceSourceCache {
  files: Map<string, string[]>;
}

export function createResourceSourceCache(): ResourceSourceCache {
  return { files: new Map() };
}

function relativeKey(value: string): string {
  const key = value.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!key || key.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error(`Invalid resource path: ${value}`);
  }
  return key;
}

async function listFiles(root: string): Promise<string[]> {
  if (!(await fs.pathExists(root))) return [];
  const results: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) results.push(path.relative(root, full));
    }
  };
  await walk(root);
  return results;
}

export async function copyBundledResourceIfChanged(source: string, target: string): Promise<void> {
  const current = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (current?.isFile() && current.size === (await fs.stat(source)).size &&
      (await fs.readFile(source)).equals(await fs.readFile(target))) return;
  await fs.remove(target);
  await fs.ensureDir(path.dirname(target));
  await fs.copy(source, target);
}

async function removeLegacyMarker(targetDir: string, markerName: string): Promise<void> {
  await fs.remove(path.join(targetDir, markerName)).catch(() => undefined);
}

/**
 * Remove obsolete known paths, then copy only changed files of the desired variant.
 * Paths no bundled variant knows about are left alone.
 */
export async function syncBundledResourceFiles(
  targetDir: string,
  desiredRoots: BundledResourceRoot[],
  knownRoots: BundledResourceRoot[],
  markerName: string,
  options: { removeAbsent?: boolean; dryRun?: boolean; sourceCache?: ResourceSourceCache; onProgress?: (completed: number, total: number) => void } = {},
): Promise<void> {
  if (options.dryRun) return;
  for (const root of desiredRoots) {
    if (!(await fs.pathExists(root.source))) throw new Error(`Bundled resource directory is unavailable: ${root.source}`);
  }
  const lists = options.sourceCache?.files ?? new Map<string, string[]>();
  const listSource = async (dir: string): Promise<string[]> => {
    if (!lists.has(dir)) lists.set(dir, await listFiles(dir));
    return lists.get(dir)!;
  };
  const keysOf = async (root: BundledResourceRoot): Promise<Array<{ key: string; file: string }>> =>
    (await listSource(root.source)).map(relative => ({
      key: relativeKey(path.posix.join(root.targetPrefix || '', relative.replace(/\\/g, '/'))),
      file: path.join(root.source, relative),
    }));

  const desiredFiles = (await Promise.all(desiredRoots.map(keysOf))).flat();
  const obsolete: string[] = [];
  if (options.removeAbsent !== false) {
    const desired = new Set<string>();
    for (const { key } of desiredFiles) desired.add(key.toLowerCase());
    const known = new Map<string, string>();
    for (const root of knownRoots) {
      for (const { key } of await keysOf(root)) known.set(key.toLowerCase(), key);
    }
    for (const key of known.values()) if (!desired.has(key.toLowerCase())) obsolete.push(key);
  }
  const total = obsolete.length + desiredFiles.length;
  let completed = 0;
  options.onProgress?.(0, total);
  for (const key of obsolete) {
    await fs.remove(path.join(targetDir, key));
    options.onProgress?.(++completed, total);
  }
  for (const { key, file } of desiredFiles) {
    await copyBundledResourceIfChanged(file, path.join(targetDir, key));
    options.onProgress?.(++completed, total);
  }
  await removeLegacyMarker(targetDir, markerName);
}

/** Remove one switched-off client resource at its known path. */
export async function removeBundledResourceFile(
  targetDir: string,
  relative: string,
  _knownSources: string[],
  markerName: string,
  _options: { ifCustom?: 'backup' } = {},
): Promise<boolean> {
  await fs.remove(path.join(targetDir, relativeKey(relative)));
  await removeLegacyMarker(targetDir, markerName);
  return true;
}

/** Install one client variant at a known path, replacing existing bytes. */
export async function installBundledResourceFile(
  targetDir: string,
  relative: string,
  source: string,
  _knownSources: string[],
  markerName: string,
  _options: { ifCustom?: 'skip' | 'error' } = {},
): Promise<boolean> {
  await copyBundledResourceIfChanged(source, path.join(targetDir, relativeKey(relative)));
  await removeLegacyMarker(targetDir, markerName);
  return true;
}

/** Mutate every file under targetDir that `accepts` selects. */
export async function mutateManagedResourceFiles(
  targetDir: string,
  markerName: string,
  accepts: (relative: string) => boolean,
  mutate: (file: string, relative: string) => Promise<void>,
): Promise<void> {
  for (const relative of await listFiles(targetDir)) {
    const key = relative.replace(/\\/g, '/');
    if (accepts(key)) await mutate(path.join(targetDir, relative), key);
  }
  await removeLegacyMarker(targetDir, markerName);
}
