import path from 'node:path';
import fs from 'fs-extra';
import type { ModIntegrityManifest } from './mod-integrity-service';
import { enumerateClientModFiles } from './client-mod-files';

const MANAGED_MARKERS = [
  ['environment', '.quenching-public-environment-files'],
  ['environment/dnc', '.quenching-dnc-profile'],
  ['environment/foliage', '.quenching-managed-foliage.json'],
  ['shaders', '.quenching-shader-profile'],
  ['terrainart', '.quenching-terrain-slk'],
  ['terrainart', '.quenching-terrain-tiles'],
  ['terrainart/blight', '.quenching-managed-blight.json'],
  ['units', '.quenching-profile-skin'],
  ['units', '.quenching-skin-template'],
  ['webui', '.quenching-webui-files'],
  ['ui', '.quenching-managed-ui.json'],
  ['scripts', '.quenching-managed-scripts.json'],
  ['textures', '.quenching-managed-glow.json'],
  ['', '.quenching-vision-files'],
] as const;

function safeRelative(relative: string): boolean {
  return !!relative && !path.isAbsolute(relative) && !relative.includes('\\') &&
    !relative.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'));
}

async function ordinaryFile(buildDir: string, relative: string): Promise<string | null> {
  if (!safeRelative(relative)) return null;
  let current = buildDir;
  const parts = relative.split('/');
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) return null;
  }
  const file = path.join(current, parts.at(-1)!);
  const stat = await fs.lstat(file).catch(() => null);
  return stat?.isFile() && !stat.isSymbolicLink() ? file : null;
}

/** Include every location used by graphics profiles and the branch switch. */
async function resourceRoots(buildDir: string): Promise<string[]> {
  const roots = [buildDir];
  const add = async (relative: string) => {
    let current = buildDir;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      const stat = await fs.lstat(current).catch(() => null);
      if (!stat?.isDirectory() || stat.isSymbolicLink()) return;
    }
    roots.push(current);
  };
  for (const relative of ['QMoff', 'QMoff/.branch-disabled-overlaps', 'QMoff/branch-created']) await add(relative);
  const residuals = path.join(buildDir, 'QMoff', 'branch-residuals');
  await add('QMoff/branch-residuals');
  if (roots.includes(residuals)) {
    roots.pop();
    for (const entry of await fs.readdir(residuals, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) await add(`QMoff/branch-residuals/${entry.name}`);
    }
  }
  return roots;
}

export async function readModUninstallVersions(buildDir: string): Promise<string[]> {
  const versions = new Set<string>();
  for (const base of await resourceRoots(buildDir)) {
    for (const relative of ['_patch/keep.que', 'patch/keep.que']) {
      const file = await ordinaryFile(base, relative);
      if (!file) continue;
      const text = await fs.readFile(file, 'utf8');
      const version = [...text.matchAll(/^-v(\d+(?:\.\d+){1,2})-\s*$/gim)].at(-1)?.[1];
      if (version) versions.add(version);
    }
  }
  return [...versions];
}

/** Remove known package/client paths, including modified and parked copies.
 * Walk only known resource prefixes; never follow links or remove unlisted files. */
export async function removeVerifiedModFiles(buildDir: string, manifest: ModIntegrityManifest | ModIntegrityManifest[], quenchingDir?: string): Promise<{ removed: number; preserved: string[] }> {
  const buildStat = await fs.lstat(buildDir);
  if (!buildStat.isDirectory() || buildStat.isSymbolicLink()) throw new Error('Unsafe MOD directory');
  const expected = new Set<string>();
  const add = (relative: string, hash: string) => {
    if (!safeRelative(relative) || !/^[a-f0-9]{64}$/i.test(hash)) return;
    expected.add(relative.toLowerCase());
  };
  for (const list of Array.isArray(manifest) ? manifest : [manifest]) {
    for (const record of list.files) add(record.path, record.sha256);
  }
  const roots = await resourceRoots(buildDir);
  const markers = new Set<string>();
  for (const base of roots) {
    for (const relative of await enumerateClientModFiles(base, false, quenchingDir)) expected.add(relative.toLowerCase());
    for (const [dir, marker] of MANAGED_MARKERS) {
      const relative = [dir, marker].filter(Boolean).join('/');
      const file = await ordinaryFile(base, relative);
      if (!file) continue;
      const state = await fs.readJson(file).catch(() => null);
      if (state?.schema !== 1 || !state.files || typeof state.files !== 'object') continue;
      for (const [name, hash] of Object.entries(state.files)) {
        if (typeof hash === 'string') add([dir, name].filter(Boolean).join('/'), hash);
      }
      expected.add(relative.toLowerCase());
      markers.add(relative.toLowerCase());
    }
  }
  const prefixes = new Set<string>();
  for (const relative of expected) {
    const parts = relative.split('/');
    for (let i = 1; i < parts.length; i++) prefixes.add(parts.slice(0, i).join('/'));
  }
  let removed = 0;
  const walk = async (base: string, relative = ''): Promise<boolean> => {
    let changed = false;
    for (const entry of await fs.readdir(path.join(base, relative), { withFileTypes: true })) {
      const name = [relative, entry.name].filter(Boolean).join('/');
      const key = name.toLowerCase();
      const file = path.join(base, name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isFile() && expected.has(key)) {
        await fs.unlink(file);
        if (!markers.has(key)) removed++;
        changed = true;
      } else if (entry.isDirectory() && prefixes.has(key) && await walk(base, name)) {
        // Non-recursive removal succeeds only when no player files remain.
        await fs.rmdir(file).catch((error: NodeJS.ErrnoException) => {
          if (!['ENOTEMPTY', 'EEXIST'].includes(error.code || '')) throw error;
        });
        changed = true;
      }
    }
    return changed;
  };
  for (const base of roots) await walk(base);
  // Installation markers are metadata, not game resources. Remove them last so
  // a failed deletion can be retried with the same package inventory.
  for (const base of roots) {
    for (const relative of ['_patch/keep.que', 'patch/keep.que']) {
      const file = await ordinaryFile(base, relative);
      if (file && /^-v\d+(?:\.\d+){1,2}-\s*$/im.test(await fs.readFile(file, 'utf8'))) await fs.unlink(file);
    }
  }
  const installed = await ordinaryFile(buildDir, '.quenching/installed-mod.json');
  if (installed && (await fs.readJson(installed).catch(() => null))?.product === 'quenching-mod') await fs.unlink(installed);
  const versions = new Set((Array.isArray(manifest) ? manifest : [manifest]).map(item => item.version));
  for (const base of roots) {
    for (const version of versions) {
      if (!/^\d+(?:\.\d+){1,2}$/.test(version || '')) continue;
      const file = await ordinaryFile(base, `_patch/qmf-${version}.files.json.gz`);
      if (file) await fs.unlink(file);
    }
  }
  return { removed, preserved: [] };
}
