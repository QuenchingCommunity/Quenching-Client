import fs from 'fs-extra';
import path from 'path';
import { withResourceDirectory } from './resource-directory-queue';

const HD_PUBLIC_ROOTS = ['environmentmap', 'foliage', 'sky'] as const;

/** Merge distinct files; the destination wins on a same-name collision. */
async function mergeDirectory(source: string, target: string): Promise<void> {
  const [sourceStat, targetStat] = await Promise.all([fs.lstat(source), fs.lstat(target)]);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink() ||
      !targetStat.isDirectory() || targetStat.isSymbolicLink()) {
    throw new Error(`Environment path is not an ordinary directory: ${source} -> ${target}`);
  }
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Environment contains a symbolic link: ${from}`);
    if (!(await fs.pathExists(to))) {
      await fs.move(from, to, { overwrite: false });
    } else if (entry.isDirectory() && (await fs.lstat(to)).isDirectory()) {
      await mergeDirectory(from, to);
    } else {
      await fs.remove(from);
    }
  }
  if ((await fs.readdir(source)).length === 0) await fs.rmdir(source);
}

async function moveEnvironmentRoots(sourceBase: string, targetBase: string): Promise<boolean> {
  let moved = false;
  const completed: Array<{ from: string; to: string }> = [];
  try {
    for (const name of HD_PUBLIC_ROOTS) {
      const from = path.join(sourceBase, name);
      const to = path.join(targetBase, name);
      if (!(await fs.pathExists(from))) continue;
      await fs.ensureDir(path.dirname(to));
      if (!(await fs.pathExists(to))) {
        await fs.move(from, to, { overwrite: false });
        completed.push({ from, to });
      } else {
        await mergeDirectory(from, to);
      }
      moved = true;
    }
    return moved;
  } catch (error) {
    for (const move of completed.reverse()) {
      if (!(await fs.pathExists(move.from)) && await fs.pathExists(move.to)) {
        await fs.move(move.to, move.from, { overwrite: false });
      }
    }
    throw error;
  }
}

/** DE parks the active HD public environment. */
export async function parkHdPublicEnvironment(retailDir: string): Promise<boolean> {
  return withResourceDirectory(path.join(retailDir, 'environment', 'foliage'), () => moveEnvironmentRoots(
    path.join(retailDir, 'environment'),
    path.join(retailDir, 'QMoff', 'hd-environment')));
}

/** Restore HD environment; same-name active files take precedence. */
export async function restoreHdPublicEnvironment(retailDir: string): Promise<boolean> {
  return withResourceDirectory(path.join(retailDir, 'environment', 'foliage'), () => moveEnvironmentRoots(
    path.join(retailDir, 'QMoff', 'hd-environment'),
    path.join(retailDir, 'environment')));
}
