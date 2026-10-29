import fs from 'fs-extra';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';

export interface ZipExtractionOptions {
  stripLeadingDirectory?: string | string[];
  mapFile?: (name: string) => string | null;
  onProgress?: (percent: number, name: string) => void;
}

/** Read only the ZIP directory. A later duplicate replaces the earlier entry
 * and therefore needs space only once in the extraction destination. */
export async function getZipUncompressedBytes(zipPath: string, stripLeadingDirectory?: string | string[]): Promise<number> {
  const { resourcePackageBytes } = await import('./bundled-packages');
  const bundled = await resourcePackageBytes(zipPath);
  if (bundled !== null) return bundled;
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error || new Error('Cannot open ZIP archive'));
      const sizes = new Map<string, number>();
      const wrappers = Array.isArray(stripLeadingDirectory) ? stripLeadingDirectory
        : stripLeadingDirectory ? [stripLeadingDirectory] : [];
      zip.on('entry', (entry) => {
        if (!entry.fileName.endsWith('/')) {
          let name = entry.fileName.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
          for (const wrapper of wrappers) {
            if (name.toLowerCase().startsWith(`${wrapper.toLowerCase()}/`)) {
              name = name.slice(wrapper.length + 1);
              break;
            }
          }
          sizes.set(name.toLowerCase(), entry.uncompressedSize);
        }
        zip.readEntry();
      });
      zip.once('end', () => {
        const bytes = [...sizes.values()].reduce((total, size) => total + size, 0);
        if (!Number.isSafeInteger(bytes)) return reject(new Error('ZIP uncompressed size is invalid'));
        resolve(bytes);
      });
      zip.once('error', reject);
      zip.readEntry();
    });
  });
}

/** Extract one entry at a time. Duplicate archive paths use the last entry,
 * matching ordinary ZIP extraction, while traversal and link entries fail. */
export async function extractZipArchive(zipPath: string, destination: string, options: ZipExtractionOptions = {}): Promise<number> {
  const { extractResourcePackage } = await import('./bundled-packages');
  const bundled = await extractResourcePackage(zipPath, destination, options);
  if (bundled !== null) return bundled;
  const root = path.resolve(destination);
  await fs.ensureDir(root);
  return new Promise<number>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) return reject(openError || new Error('Cannot open ZIP archive'));
      let settled = false;
      let processed = 0;
      const extractedSizes = new Map<string, number>();
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(error);
      };
      zip.on('error', fail);
      zip.on('end', () => {
        if (settled) return;
        settled = true;
        const bytes = [...extractedSizes.values()].reduce((total, size) => total + size, 0);
        if (!Number.isSafeInteger(bytes)) return reject(new Error('ZIP uncompressed size is invalid'));
        resolve(bytes);
      });
      zip.on('entry', (entry) => {
        void (async () => {
          const raw = entry.fileName.replace(/\\/g, '/');
          if (raw.includes('\0') || raw.startsWith('/') || /^[a-z]:/i.test(raw)) throw new Error(`Unsafe ZIP path: ${entry.fileName}`);
          const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (mode === 0o120000) throw new Error(`ZIP link entry is not supported: ${entry.fileName}`);
          let name = raw.replace(/^(?:\.\/)+/, '');
          const wrappers = options.stripLeadingDirectory;
          for (const wrapper of Array.isArray(wrappers) ? wrappers : wrappers ? [wrappers] : []) {
            if (name.toLowerCase() === wrapper.toLowerCase()) { name = ''; break; }
            if (name.toLowerCase().startsWith(`${wrapper.toLowerCase()}/`)) {
              name = name.slice(wrapper.length + 1);
              break;
            }
          }
          const isDirectory = raw.endsWith('/');
          if (options.mapFile && name) name = isDirectory ? '' : options.mapFile(name) || '';
          if (name) {
            const parts = name.replace(/\/$/, '').split('/');
            if (parts.some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
              throw new Error(`Unsafe ZIP path: ${entry.fileName}`);
            }
            const target = path.resolve(root, ...parts);
            if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`ZIP path escapes destination: ${entry.fileName}`);
            if (isDirectory) await fs.ensureDir(target);
            else {
              await fs.ensureDir(path.dirname(target));
              const input = await new Promise<NodeJS.ReadableStream>((ok, no) => {
                zip.openReadStream(entry, (error, stream) => error || !stream ? no(error || new Error(`Cannot read ${entry.fileName}`)) : ok(stream));
              });
              await pipeline(input, fs.createWriteStream(target));
              extractedSizes.set(parts.join('/').toLowerCase(), entry.uncompressedSize);
            }
          }
          processed++;
          options.onProgress?.(Math.round(processed / Math.max(zip.entryCount, 1) * 100), entry.fileName);
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  });
}
