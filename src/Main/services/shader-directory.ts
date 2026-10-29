import path from 'node:path';
import fs from 'fs-extra';

const directoryLockCodes = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Give short-lived scanner/directory handles a chance to close. */
export async function renameShaderDirectory(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(from, to); return; }
    catch (error) {
      if (attempt === 2 || !directoryLockCodes.has((error as NodeJS.ErrnoException).code || '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

async function filesIn(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe shader directory: ${dir}`);
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.push(path.relative(root, full));
      else throw new Error(`Unsupported shader entry: ${full}`);
    }
  };
  await walk(root);
  return files;
}

/** A locked directory can still allow file writes. Back up before touching any bytes. */
export async function replaceLockedShaderFiles(
  target: string, prepared: string, backup: string, retainBackup: () => void,
  options: { markerName?: string; label?: string; onProgress?: (completed: number, total: number) => void } = {},
): Promise<void> {
  const label = options.label ?? 'Shader';
  const key = (relative: string) => process.platform === 'win32' ? relative.toLowerCase() : relative;
  const oldFiles = new Map((await filesIn(target)).map(relative => [key(relative), relative]));
  const newFiles = new Map((await filesIn(prepared)).map(relative => [key(relative), relative]));
  const targetFile = (relative: string) => path.join(target, oldFiles.get(relative) ?? newFiles.get(relative)!);
  const changes: string[] = [];
  for (const relative of new Set([...oldFiles.keys(), ...newFiles.keys()])) {
    if (oldFiles.has(relative) && newFiles.has(relative) &&
        (await fs.readFile(targetFile(relative))).equals(await fs.readFile(path.join(prepared, newFiles.get(relative)!)))) continue;
    // Reject file/directory collisions before starting the transaction.
    if (!oldFiles.has(relative)) {
      const stat = await fs.lstat(targetFile(relative)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (stat) throw new Error(`Shader path is not a regular file: ${path.join(target, relative)}`);
    }
    changes.push(relative);
  }
  // A successful source marker must never be written before its resource files.
  const marker = options.markerName ?? '.quenching-shader-pack';
  changes.sort((a, b) => Number(a === marker) - Number(b === marker));
  for (const relative of changes) {
    if (oldFiles.has(relative)) await fs.copy(targetFile(relative), path.join(backup, relative));
  }
  const touched: string[] = [];
  options.onProgress?.(0, changes.length);
  try {
    for (const relative of changes) {
      touched.push(relative); // copyFile can truncate before failing.
      const file = targetFile(relative);
      if (newFiles.has(relative)) {
        await fs.ensureDir(path.dirname(file));
        await fs.copyFile(path.join(prepared, newFiles.get(relative)!), file);
      } else await fs.unlink(file);
      options.onProgress?.(touched.length, changes.length);
    }
  } catch (error) {
    const failures: unknown[] = [];
    for (const relative of touched.reverse()) {
      try {
        const file = targetFile(relative);
        if (oldFiles.has(relative)) {
          const saved = await fs.readFile(path.join(backup, relative));
          const current = await fs.readFile(file).catch((e: NodeJS.ErrnoException) => {
            if (e.code === 'ENOENT') return null;
            throw e;
          });
          if (!current?.equals(saved)) await fs.copyFile(path.join(backup, relative), file);
        } else await fs.remove(file);
      } catch (restoreError) { failures.push(restoreError); }
    }
    if (failures.length) {
      retainBackup();
      throw new AggregateError([error, ...failures], `${label} update and rollback failed; backup retained at ${backup}`);
    }
    throw error;
  }
}

export function isShaderDirectoryLock(error: unknown): boolean {
  return directoryLockCodes.has((error as NodeJS.ErrnoException)?.code || '');
}
