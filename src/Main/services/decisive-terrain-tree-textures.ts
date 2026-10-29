import fs from 'fs-extra';
import path from 'node:path';
import { extractZipArchive } from './zip-extraction';
import { resourceArchiveExists } from './bundled-packages';

const TEXTURE_DIRS = ['lordaerontree', 'ashenvaletree'] as const;
const TEXTURE_DIR_SET = new Set<string>(TEXTURE_DIRS);

async function ordinaryDirectory(directory: string): Promise<void> {
  const stat = await fs.lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
    throw new Error(`地形纹理目录不是普通目录: ${directory}`);
  }
}

async function listTextureFiles(directory: string, relative = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) files.push(...await listTextureFiles(directory, child));
    else if (entry.isFile() && !entry.isSymbolicLink()) files.push(child);
    else throw new Error(`地形纹理压缩包包含不支持的目录项: ${child}`);
  }
  return files;
}

async function ordinaryDestination(root: string, relative: string): Promise<void> {
  let current = root;
  const parts = relative.split(path.sep);
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    await ordinaryDirectory(current);
  }
  const target = path.join(current, parts[parts.length - 1]);
  const stat = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) {
    throw new Error(`地形纹理目标不是普通文件: ${target}`);
  }
}

/** DE terrain owns exactly these two texture directories in the selected game build. */
export async function syncDecisiveTerrainTreeTextures(
  buildDir: string,
  quenchingAssetsDir: string,
  enabled: boolean,
): Promise<void> {
  const texturesDir = path.join(buildDir, 'replaceabletextures');
  await ordinaryDirectory(buildDir);
  await ordinaryDirectory(texturesDir);
  for (const name of TEXTURE_DIRS) await ordinaryDirectory(path.join(texturesDir, name));

  if (!enabled) {
    for (const name of TEXTURE_DIRS) await fs.remove(path.join(texturesDir, name));
    return;
  }

  const archive = path.join(quenchingAssetsDir, 'lordaerontree.zip');
  if (!(await resourceArchiveExists(archive))) throw new Error(`缺少决定版地形树木纹理包: ${archive}`);
  const staging = await fs.mkdtemp(path.join(buildDir, '.quenching-de-tree-textures-'));
  try {
    await extractZipArchive(archive, staging, {
      mapFile: (name) => {
        const normalized = name.replace(/\\/g, '/');
        const parts = normalized.split('/');
        if (parts.length < 2 || !TEXTURE_DIR_SET.has(parts[0].toLowerCase())) {
          throw new Error(`决定版地形纹理包包含意外路径: ${name}`);
        }
        return normalized;
      },
    });
    const files = new Map<string, string[]>();
    for (const name of TEXTURE_DIRS) {
      const source = path.join(staging, name);
      if (!(await fs.pathExists(source))) throw new Error(`决定版地形纹理包缺少目录: ${name}`);
      const entries = await listTextureFiles(source);
      if (entries.length === 0) throw new Error(`决定版地形纹理包目录为空: ${name}`);
      files.set(name, entries);
      for (const relative of entries) await ordinaryDestination(path.join(texturesDir, name), relative);
    }
    for (const [name, entries] of files) {
      const source = path.join(staging, name);
      const target = path.join(texturesDir, name);
      for (const relative of entries) {
        const destination = path.join(target, relative);
        await fs.ensureDir(path.dirname(destination));
        await fs.copyFile(path.join(source, relative), destination);
      }
    }
  } finally {
    await fs.remove(staging);
  }
}
