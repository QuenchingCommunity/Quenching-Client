import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

export async function readUiSource(quenchingDir, name) {
  const expanded = path.resolve(quenchingDir, '../unpacked/packages', name.slice(0, -4));
  if (!(await fs.stat(expanded).catch(() => null))?.isDirectory()) return JSZip.loadAsync(await fs.readFile(path.join(quenchingDir, name)));
  const zip = new JSZip();
  const visit = async (folder, prefix) => {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('UI source cannot contain links');
      const file = path.join(folder, entry.name), relative = prefix + entry.name;
      if (entry.isDirectory()) await visit(file, relative + '/');
      else zip.file(relative, await fs.readFile(file), { createFolders: false });
    }
  };
  await visit(expanded, '');
  return zip;
}
export async function uiSourceHash(quenchingDir, name) {
  const zip = await readUiSource(quenchingDir, name), hash = createHash('sha256');
  for (const entry of Object.values(zip.files).filter(entry => !entry.dir).sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(entry.name); hash.update(await entry.async('nodebuffer'));
  }
  return hash.digest('hex');
}
