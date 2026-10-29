import fs from 'fs-extra';
import path from 'node:path';
import { extractArchive } from './archive-extraction';

const CLIENT_PACKAGE_MESSAGE = '这是客户端文件，不是 MOD 资源包。请解压客户端后运行 QMClient，再选择 QMF 完整资源包（ZIP、RAR、7z）或已解压的资源文件夹。';

function packagePath(name: string): string {
  const relative = name.replace(/\\/g, '/').replace(/^(?:QMF\d+(?:\.\d+)+\/|_retail_\/|_ptr_\/)+/i, '');
  if (/(?:^|\/)(?:QMClient\.exe|app\.asar)$/i.test(relative) || /\.app\/Contents\//i.test(relative)) {
    throw new Error(CLIENT_PACKAGE_MESSAGE);
  }
  return relative;
}

type InstallProgress = (percent: number, message: string) => void;
type BeforeInstall = () => Promise<void>;

async function listPackageFiles(source: string): Promise<Array<{ relative: string; bytes: number }>> {
  const files: Array<{ relative: string; bytes: number }> = [];
  const visit = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      const relative = path.relative(source, file);
      packagePath(relative); // Detect client folders before copying any files.
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && !(dir === source && /\.(?:zip|rar|7z)$/i.test(entry.name))) {
        files.push({ relative, bytes: (await fs.stat(file)).size });
      }
    }
  };
  await visit(source);
  return files;
}

async function copyPackageFiles(source: string, targetDir: string, onProgress?: InstallProgress, beforeInstall?: BeforeInstall): Promise<number> {
  const files = await listPackageFiles(source);
  if (!files.length) throw new Error('所选资源包中没有可安装的文件。');
  await beforeInstall?.();
  for (let i = 0; i < files.length; i++) {
    const relative = files[i].relative;
    const from = path.join(source, relative), to = path.join(targetDir, relative);
    if (path.resolve(from).toLowerCase() !== path.resolve(to).toLowerCase()) {
      await fs.copy(from, to, { overwrite: true, preserveTimestamps: true });
    }
    if (i % 100 === 0 || i === files.length - 1) {
      onProgress?.(70 + Math.round((i + 1) / files.length * 28), '正在安装资源包');
    }
  }
  return files.reduce((sum, file) => sum + file.bytes, 0);
}

/** Copy an already extracted package, leaving its source and extra player files intact. */
export async function installPackageDirectory(source: string, targetDir: string, onProgress?: InstallProgress, beforeInstall?: BeforeInstall): Promise<number> {
  const entries = await fs.readdir(source, { withFileTypes: true });
  const wrapper = entries.find(entry => entry.isDirectory() && /^(?:QMF\d+(?:\.\d+)+|_retail_|_ptr_)$/i.test(entry.name));
  // A downloaded ZIP's outer folder may wrap the actual package once.
  const root = wrapper && !entries.some(entry => entry.isDirectory() && /^(?:units|environment|RUnits|textures|shaders)$/i.test(entry.name))
    ? path.join(source, wrapper.name) : source;
  onProgress?.(0, '正在读取资源文件夹');
  return copyPackageFiles(root, targetDir, onProgress, beforeInstall);
}

export async function installPackageSources(input: string[], targetDir: string, onProgress?: InstallProgress, beforeInstall?: BeforeInstall): Promise<number> {
  if (input.length === 1 && (await fs.stat(input[0])).isDirectory()) {
    return installPackageDirectory(input[0], targetDir, onProgress, beforeInstall);
  }
  return installPackageArchives(await resolvePackageArchives(input), targetDir, onProgress, beforeInstall);
}

/** Official A/B downloads are ordinary ZIPs. Selecting either finds its
 * sibling, while a single older ZIP or an explicit set of ZIPs also works. */
export async function resolvePackageArchives(input: string | string[]): Promise<string[]> {
  const files = [...new Set(Array.isArray(input) ? input : [input])];
  if (files.length === 1) {
    const match = /^(QMF\d+(?:\.\d+)+-Full-)([AB])(\.zip)$/i.exec(path.basename(files[0]));
    if (match) {
      const sibling = path.join(path.dirname(files[0]), `${match[1]}${match[2].toUpperCase() === 'A' ? 'B' : 'A'}${match[3]}`);
      if (await fs.pathExists(sibling)) files.push(sibling);
    }
  }
  return files;
}

/** Installation uses archive contents, never a manifest to require files.
 * All archives are extracted before writing to the selected game branch. */
export async function installPackageArchives(
  zipPaths: string[], targetDir: string,
  onProgress?: InstallProgress,
  beforeInstall?: BeforeInstall,
): Promise<number> {
  const tempParent = path.join(path.dirname(targetDir), '_tmp');
  await fs.ensureDir(tempParent);
  if ((await fs.lstat(tempParent)).isSymbolicLink()) throw new Error('安装暂存目录不能是链接。');
  const staging = await fs.mkdtemp(path.join(tempParent, 'package-install-'));
  try {
    for (let i = 0; i < zipPaths.length; i++) {
      await extractArchive(zipPaths[i], staging, {
        stripLeadingDirectory: ['_retail_', '_ptr_'],
        mapFile: packagePath,
        onProgress: (percent, name) => onProgress?.(
          Math.round((i + percent / 100) / zipPaths.length * 70),
          `正在解压 ${i + 1}/${zipPaths.length}：${name}`,
        ),
      });
    }
    return await copyPackageFiles(staging, targetDir, onProgress, beforeInstall);
  } finally {
    await fs.remove(staging);
  }
}
