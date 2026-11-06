import crypto from 'node:crypto';
import path from 'node:path';
import type { SyncFile } from '../../shared/file-sync';

// Raw ASAR bytes must remain ordinary files even inside an Electron process.
const fs: typeof import('node:fs') = process.versions.electron ? require('original-fs') : require('node:fs');
const fsp = fs.promises;
type CacheProduct = 'client' | 'mod';
async function location(root: string, sha256: string, product: CacheProduct): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid cache identity');
  let cursor = root;
  if (product !== 'client' && product !== 'mod') throw new Error('Invalid cache product');
  for (const segment of ['', '_tmp', product + '-update-cache', sha256 + '.bin']) {
    if (segment) cursor = path.join(cursor, segment);
    const stat = await fsp.lstat(cursor).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (stat?.isSymbolicLink()) throw new Error('Linked update cache');
  }
  return cursor;
}
async function verified(file: string, record: Pick<SyncFile, 'size' | 'sha256'>): Promise<boolean> {
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size !== record.size) return false;
  const hash = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest('hex') === record.sha256;
}
export async function reuseUpdateArtifactCache(root: string, record: Pick<SyncFile, 'size' | 'sha256'>, output: string, product: CacheProduct = 'client'): Promise<boolean> {
  try {
    const file = await location(root, record.sha256, product);
    if (!await verified(file, record)) return false;
    await fsp.copyFile(file, output, fs.constants.COPYFILE_EXCL);
    return true;
  } catch (error) { console.warn('[UpdateCache] Cache unavailable; using verified release sources:', String(error)); return false; }
}
/** Retained across failed transactions, removed by the helper after health commit. */
export async function storeUpdateArtifactCache(root: string, record: Pick<SyncFile, 'size' | 'sha256'>, source: string, product: CacheProduct = 'client'): Promise<void> {
  let temporary: string | undefined;
  try {
    const file = await location(root, record.sha256, product);
    if (await verified(file, record)) return;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    temporary = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    await fsp.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
    if (!await verified(temporary, record)) throw new Error('Cache copy failed verification');
    await location(root, record.sha256, product);
    await fsp.rename(temporary, file);
  } catch (error) { console.warn('[UpdateCache] Could not retain retry cache:', String(error)); }
  finally { if (temporary) await fsp.rm(temporary, { force: true }).catch(() => undefined); }
}

export async function removeUpdateArtifactCache(root: string, record: Pick<SyncFile, 'size' | 'sha256'>, product: CacheProduct): Promise<void> {
  try {
    const file = await location(root, record.sha256, product);
    if (await verified(file, record)) await fsp.rm(file);
  } catch (error) { console.warn('[UpdateCache] Committed update retained a busy cache:', String(error)); }
}
