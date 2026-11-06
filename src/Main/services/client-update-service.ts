import { app } from 'electron';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { fetchReleaseGate, previewUpdatesEnabled } from './release-gate-service';
import { isNewerClientVersion } from '../../shared/client-version';
import { FileSnapshot, FileSyncDescriptor, SyncArtifact, planFileSync, syncFileArtifact, syncSourceUrls, validateFileSync, validateSyncArtifact } from '../../shared/file-sync';
import { decodeSnapshot, encodeSnapshot } from './file-sync-snapshot';
import { downloadUpdateFile, rememberUpdateDownloadSource, updateDownloadSources } from './update-download';
import { updateTestEnabled } from './update-channel';
import { fetchUpdateMetadata, requestUpdateMetadata } from './update-metadata';
import { updateMetadataUrls } from './update-metadata-urls';
import { reuseUpdateArtifactCache as reuseClientUpdateCache, storeUpdateArtifactCache as storeClientUpdateCache } from './update-artifact-cache';

// Read app.asar as an update file without disabling ASAR module loading in the UI process.
const fs: typeof import('node:fs') = require('original-fs');
const fsp = fs.promises;
const { statfs } = fsp;

const MAX_MANIFEST = 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const VERSION = /^\d+\.\d+(?:\.\d+)?$/;
const DOWNLOAD_LIMIT = 2 * 1024 * 1024 * 1024;
let preparing = false;

function safeUpdateDiagnostic(value: unknown): string {
  return String(value).replace(/https?:\/\/[^\s'"<>]+/g, text => {
    try { const url = new URL(text); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.toString(); }
    catch { return '[invalid URL]'; }
  }).slice(0, 12_000);
}

async function retainClientUpdateFailure(error: unknown, phase: string, targetVersion?: string): Promise<void> {
  const directory = path.join(path.dirname(process.execPath), '.quenching-client-update');
  try {
    await fsp.mkdir(directory, { recursive: true });
    const failure = { schema: 1, at: new Date().toISOString(), currentVersion: app.getVersion(), targetVersion,
      phase, message: safeUpdateDiagnostic((error as Error)?.message || error), stack: safeUpdateDiagnostic((error as Error)?.stack || '') };
    const temporary = path.join(directory, 'last-error.json.tmp');
    await fsp.writeFile(temporary, JSON.stringify(failure, null, 2));
    await fsp.rename(temporary, path.join(directory, 'last-error.json'));
  } catch { console.error('[ClientUpdate] Could not retain update failure diagnostic'); }
}

export interface ClientUpdateFile {
  path: string;
  oldSha256: string | null;
  newSha256: string;
  newSize: number;
  method: 'zstd-delta' | 'replace';
  artifact: SyncArtifact;
  /** Signed target file, used when an optional binary delta cannot be applied. */
  fullArtifact?: SyncArtifact;
}
export interface ClientUpdateManifest {
  schema: 1 | 2;
  product: 'quenching-client';
  platform: 'win32-x64';
  baseVersion?: string;
  targetVersion: string;
  files: ClientUpdateFile[];
  runtimeVersion?: string;
  fileSync?: FileSyncDescriptor;
  signature: { algorithm: 'ed25519'; value: string };
}
export interface ClientUpdateStatus {
  decision: 'available' | 'upToDate' | 'blocked' | 'unavailable' | 'incompatible';
  currentVersion: string;
  targetVersion?: string;
  reason: string;
  downloadBytes?: number;
}

function canonical(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function safePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\\:\0]/.test(value) && !value.startsWith('/') &&
    value.split('/').every(segment => segment && segment !== '.' && segment !== '..') &&
    (value === 'QMClient.exe' || value === 'resources/app.asar' ||
      value.startsWith('resources/assets/') || value.startsWith('resources/statics/') || value.startsWith('resources/app.asar.unpacked/'));
}
export function validateClientUpdateManifest(raw: any, publicKey: string): ClientUpdateManifest {
  const signature = raw?.signature;
  if (signature?.algorithm !== 'ed25519' || typeof signature.value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature.value)) throw new Error('client manifest signature missing');
  const unsigned = { ...raw };
  delete unsigned.signature;
  if (!crypto.verify(null, Buffer.from(canonical(unsigned)), publicKey, Buffer.from(signature.value, 'base64'))) throw new Error('client manifest signature invalid');
  if (raw.schema === 2) {
    if (raw.product !== 'quenching-client' || raw.platform !== 'win32-x64' || !VERSION.test(raw.targetVersion) ||
        typeof raw.runtimeVersion !== 'string' || !VERSION.test(raw.runtimeVersion)) throw new Error('unsupported file-sync client manifest');
    const fileSync = validateFileSync(raw.fileSync);
    for (const artifact of [fileSync.inventory, ...Object.values(fileSync.baselines || {}), ...Object.values(fileSync.artifacts || {}), ...(fileSync.deltas || []).map(file => file.artifact)]) {
      if (syncSourceUrls(artifact).some(url => !safeDownloadUrl(url))) throw new Error('unsafe client synchronization source');
    }
    if (fileSync.objects.some(url => !safeDownloadUrl(url))) throw new Error('unsafe client file source');
    if (fileSync.deleted?.length) throw new Error('client synchronization does not delete user files');
    return { ...raw, files: [], fileSync };
  }
  if (raw.schema !== 1 || raw.product !== 'quenching-client' || raw.platform !== 'win32-x64' ||
      !VERSION.test(raw.baseVersion) || !VERSION.test(raw.targetVersion) ||
      !isNewerClientVersion(raw.targetVersion, raw.baseVersion) || !Array.isArray(raw.files) || raw.files.length === 0 || raw.files.length > 20000) {
    throw new Error('unsupported client manifest');
  }
  const seen = new Set<string>();
  let total = 0;
  for (const file of raw.files) {
    if (!safePath(file.path) || seen.has(file.path.toLowerCase()) ||
        (file.oldSha256 !== null && !(typeof file.oldSha256 === 'string' && HASH.test(file.oldSha256))) ||
        typeof file.newSha256 !== 'string' || !HASH.test(file.newSha256) ||
        !Number.isSafeInteger(file.newSize) || file.newSize <= 0 || file.newSize > DOWNLOAD_LIMIT ||
        !['zstd-delta', 'replace'].includes(file.method) ||
        (file.method === 'zstd-delta' && !['QMClient.exe', 'resources/app.asar'].includes(file.path)) ||
        (file.method === 'zstd-delta' && file.oldSha256 === null) ||
        !file.artifact || !Number.isSafeInteger(file.artifact.size) || file.artifact.size <= 0 || file.artifact.size > DOWNLOAD_LIMIT ||
        !HASH.test(file.artifact.sha256) || !Array.isArray(file.artifact.sources) || file.artifact.sources.length === 0 || file.artifact.sources.length > 8 ||
        !file.artifact.sources.every((url: unknown) => typeof url === 'string' &&
          (/^https:\/\//.test(url) || (process.env.QUENCHING_CLIENT_UPDATE_TEST === '1' && /^http:\/\/127\.0\.0\.1:\d+\//.test(url))))) {
      throw new Error(`invalid client file entry: ${String(file?.path)}`);
    }
    if (file.method === 'replace' && (file.artifact.size !== file.newSize || file.artifact.sha256 !== file.newSha256)) {
      throw new Error(`replacement differs from signed target: ${file.path}`);
    }
    if (file.fullArtifact !== undefined) {
      const full = validateSyncArtifact(file.fullArtifact);
      if (file.method !== 'zstd-delta' || full.size !== file.newSize || full.sha256 !== file.newSha256 ||
          syncSourceUrls(full).some(url => !safeDownloadUrl(url))) throw new Error(`invalid full-file fallback: ${file.path}`);
    }
    seen.add(file.path.toLowerCase());
    total += Math.max(file.artifact.size, file.fullArtifact?.size || 0);
    if (!Number.isSafeInteger(total) || total > 8 * DOWNLOAD_LIMIT) throw new Error('client update too large');
  }
  if (seen.has('qmclient.exe') !== seen.has('resources/app.asar')) throw new Error('EXE and ASAR must update together');
  return raw as ClientUpdateManifest;
}
function safeDownloadUrl(url: string): boolean {
  return /^https:\/\//.test(url) || ((updateTestEnabled() || process.env.QUENCHING_CLIENT_UPDATE_TEST === '1') && /^http:\/\/127\.0\.0\.1:\d+\//.test(url));
}
async function hashFile(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}
async function publicKey(): Promise<string> {
  const file = app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'quenching', 'update-public-key.pem')
    : path.join(process.cwd(), 'assets', 'quenching', 'update-public-key.pem');
  return fsp.readFile(file, 'utf8');
}
async function fetchManifest(): Promise<ClientUpdateManifest> {
  const key = await publicKey();
  const override = process.env.QUENCHING_CLIENT_MANIFEST_URL?.trim();
  const urls = updateMetadataUrls(['client-manifests/latest.json', `client-manifests/${app.getVersion()}.json`], override);
  return fetchUpdateMetadata(urls, async (url, timeoutMs) => validateClientUpdateManifest(JSON.parse((await requestUpdateMetadata(url, {
    limit: MAX_MANIFEST, timeoutMs, allowHttpLoopback: updateTestEnabled() || process.env.QUENCHING_CLIENT_UPDATE_TEST === '1',
  })).toString('utf8')), key));
}
async function gateAllows(): Promise<boolean> {
  const { gate } = await fetchReleaseGate();
  return gate.allowed === 1 || previewUpdatesEnabled();
}
export async function getClientUpdateStatus(): Promise<ClientUpdateStatus> {
  const currentVersion = app.getVersion();
  if (!app.isPackaged || process.platform !== 'win32' || process.arch !== 'x64') return { decision: 'incompatible', currentVersion, reason: '仅支持 Windows x64 便携版' };
  try {
    if (!await gateAllows()) return { decision: 'blocked', currentVersion, reason: '更新尚未公开' };
    const manifest = await fetchManifest();
    if (!isNewerClientVersion(manifest.targetVersion, currentVersion)) return { decision: 'upToDate', currentVersion, targetVersion: manifest.targetVersion, reason: '已是最新版本' };
    if (manifest.schema === 2) {
      if (manifest.runtimeVersion !== process.versions.electron) return { decision: 'incompatible', currentVersion, targetVersion: manifest.targetVersion, reason: 'Electron 内核变化，请下载新的便携客户端' };
      return { decision: 'available', currentVersion, targetVersion: manifest.targetVersion, reason: '比较官方文件清单并补全到最新版本' };
    }
    if (manifest.baseVersion !== currentVersion) return { decision: 'incompatible', currentVersion, targetVersion: manifest.targetVersion, reason: '当前客户端没有对应的增量包，请手动下载新客户端' };
    return { decision: 'available', currentVersion, targetVersion: manifest.targetVersion, downloadBytes: manifest.files.reduce((sum, file) => sum + file.artifact.size, 0), reason: '可以自动更新' };
  } catch (error: any) {
    return { decision: 'unavailable', currentVersion, reason: error?.message || String(error) };
  }
}
function assertNoLinks(root: string, relative: string): void {
  let cursor = root;
  for (const segment of relative.split('/')) {
    cursor = path.join(cursor, segment);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`更新路径是链接: ${relative}`);
  }
}
type DownloadProgress = (completedBytes: number, totalBytes: number) => void;
type ClientProgress = (message: string, completed: number, total: number,
  detail?: { completedBytes: number; totalBytes: number }) => void;

async function download(file: ClientUpdateFile, destination: string, githubMirrors: readonly string[] = [], onBytes?: DownloadProgress): Promise<void> {
  const errors: string[] = [];
  const sources = updateDownloadSources(file.artifact.sources, githubMirrors);
  for (const [sourceIndex, source] of sources.entries()) {
    const slowFallback = sourceIndex < sources.length - 1;
    try {
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      if (typeof source === 'string') await requestFile(source, destination, file.artifact.size, file.artifact.sha256, slowFallback,
        received => onBytes?.(received, file.artifact.size));
      else {
        let offset = 0;
        for (const part of source.parts) {
          const partPath = destination + '.part';
          try {
            await requestFile(part.url, partPath, part.size, part.sha256.toLowerCase(), slowFallback,
              received => onBytes?.(offset + received, file.artifact.size));
            await pipeline(fs.createReadStream(partPath), fs.createWriteStream(destination, { flags: 'a' }));
            offset += part.size;
          } finally { await fsp.rm(partPath, { force: true }); }
        }
        if ((await fsp.stat(destination)).size !== file.artifact.size || await hashFile(destination) !== file.artifact.sha256) throw new Error('joined download checksum mismatch');
      }
      rememberUpdateDownloadSource(source, githubMirrors);
      return;
    } catch (error: any) {
      await fsp.rm(destination, { force: true }).catch(() => undefined);
      errors.push(`${typeof source === 'string' ? source : 'chunked:' + source.parts[0].url}: ${error?.message || String(error)}`);
    }
  }
  throw new Error(`全部下载源失败: ${errors.join('; ')}`);
}
async function requestFile(url: string, destination: string, expectedSize: number, expectedHash: string, slowFallback: boolean, onBytes?: (received: number) => void): Promise<void> {
  let lastProgressAt = 0;
  await downloadUpdateFile(url, destination, expectedSize, {
    expectedHash, slowFallback, fileSystem: fs, allowHttpLoopback: updateTestEnabled() || process.env.QUENCHING_CLIENT_UPDATE_TEST === '1',
    onProgress: onBytes ? received => {
      const now = Date.now();
      if (received === expectedSize || now - lastProgressAt >= 200) { lastProgressAt = now; onBytes(received); }
    } : undefined,
  });
}
async function reconstruct(base: string, delta: string, output: string): Promise<void> {
  const zstd = path.join(process.resourcesPath, 'assets', 'updater', 'zstd.exe');
  // zstd's Windows CLI uses narrow file APIs. Keep the Unicode installation
  // prefix in the process cwd, not in its dictionary/input/output arguments.
  const cwd = path.dirname(base);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(zstd, ['-d', '--long=28', `--patch-from=${path.basename(base)}`,
      path.relative(cwd, delta), '-o', path.relative(cwd, output)], {
      cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let detail = '';
    child.stderr?.on('data', (chunk: Buffer) => { detail = (detail + chunk.toString()).slice(-2048); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`zstd exited ${code}${detail.trim() ? ': ' + detail.trim() : ''}`)));
  });
}

const CLIENT_SNAPSHOT_PATH = 'resources/assets/updater/client-files.json.gz';
async function downloadSyncArtifact(artifact: SyncArtifact, destination: string, githubMirrors: readonly string[] = [], onBytes?: DownloadProgress): Promise<void> {
  const file = { artifact } as ClientUpdateFile;
  await download(file, destination, githubMirrors, onBytes);
}
async function loadClientSnapshot(manifest: ClientUpdateManifest, root: string, stage: string, currentVersion: string): Promise<FileSnapshot> {
  const cached = await fsp.readFile(path.join(root, ...CLIENT_SNAPSHOT_PATH.split('/'))).catch(() => null);
  if (cached) {
    try { return decodeSnapshot(cached, 'quenching-client', currentVersion); } catch { /* Use the official release snapshot. */ }
  }
  const artifact = manifest.fileSync?.baselines?.[currentVersion];
  if (!artifact) throw new Error(`缺少客户端 ${currentVersion} 的官方文件清单，不会扫描安装目录猜测版本`);
  const file = path.join(stage, 'previous.files.json.gz');
  await downloadSyncArtifact(artifact, file, manifest.fileSync?.githubMirrors);
  return decodeSnapshot(await fsp.readFile(file), 'quenching-client', currentVersion);
}

/** Stage only; the existing helper commits the selected files atomically after the UI exits. */
export async function stageClientFileSync(
  manifest: ClientUpdateManifest, root: string, stage: string, currentVersion: string,
  onProgress?: ClientProgress,
): Promise<ClientUpdateFile[]> {
  if (manifest.schema !== 2 || !manifest.fileSync) throw new Error('not a file-sync client release');
  await fsp.mkdir(stage, { recursive: true });
  onProgress?.('正在比较客户端官方文件清单', 0, 1);
  const inventoryPath = path.join(stage, 'latest.files.json.gz');
  await downloadSyncArtifact(manifest.fileSync.inventory, inventoryPath, manifest.fileSync.githubMirrors);
  const latest = decodeSnapshot(await fsp.readFile(inventoryPath), 'quenching-client', manifest.targetVersion);
  if (latest.runtimeVersion !== manifest.runtimeVersion) throw new Error('客户端内核清单不一致');
  const previous = await loadClientSnapshot(manifest, root, stage, currentVersion);
  const plan = planFileSync(previous.files, latest.files);
  for (const file of plan.changed) if (!safePath(file.path)) throw new Error(`Electron 运行时文件变化，需要新便携包: ${file.path}`);
  const selected = new Map(plan.changed.map(file => [file.path, file]));
  // The launcher and app are one release; an unchanged partner can be reused locally.
  for (const relative of ['QMClient.exe', 'resources/app.asar']) {
    const file = latest.files.find(file => file.path === relative);
    if (!file) throw new Error(`客户端清单缺少 ${relative}`);
    selected.set(relative, file);
  }
  const volume = await statfs(root);
  const bytes = [...selected.values()].reduce((sum, file) => sum + file.size * 3, 0) + 64 * 1024 ** 2;
  if (Number(volume.bavail) * Number(volume.bsize) < bytes) throw new Error('客户端磁盘空间不足，无法保留更新和回滚文件');
  const files: ClientUpdateFile[] = [];
  const transferSummary: { path: string; method: string; bytes: number }[] = [];
  for (const [index, file] of [...selected.values()].entries()) {
    assertNoLinks(root, file.path);
    const installed = path.join(root, ...file.path.split('/'));
    const oldHash = fs.existsSync(installed) ? await hashFile(installed) : null;
    const output = path.join(stage, 'new', ...file.path.split('/'));
    await fsp.mkdir(path.dirname(output), { recursive: true });
    const artifact = syncFileArtifact(file, manifest.fileSync);
    onProgress?.(`正在补全 ${file.path}`, index, selected.size + 1);
    let fileProgress = 0;
    const reportBytes: DownloadProgress = (completedBytes, totalBytes) => {
      fileProgress = Math.max(fileProgress, Math.min(0.95, 0.95 * completedBytes / (totalBytes || 1)));
      onProgress?.(`正在下载 ${file.path}`, index + fileProgress, selected.size + 1, { completedBytes, totalBytes });
    };
    let method = 'local';
    let downloadBytes = 0;
    if (oldHash === file.sha256) await fsp.copyFile(installed, output);
    else if (await reuseClientUpdateCache(root, file, output)) method = 'verified-cache';
    else {
      await fsp.rm(output, { force: true });
      const delta = manifest.fileSync.deltas?.find(delta => delta.path === file.path && delta.oldSha256 === oldHash);
      let reconstructed = false;
      if (delta) {
        try {
          const deltaPath = path.join(stage, 'artifacts', String(index) + '.zst');
          await downloadSyncArtifact(delta.artifact, deltaPath, manifest.fileSync.githubMirrors, reportBytes);
          downloadBytes += delta.artifact.size;
          await reconstruct(installed, deltaPath, output);
          reconstructed = (await fsp.stat(output)).size === file.size && await hashFile(output) === file.sha256;
          if (reconstructed) method = 'delta';
        } catch (error) { console.warn('[ClientUpdate] Optional delta failed; using the full signed file:', file.path); }
      }
      if (!reconstructed) {
        await fsp.rm(output, { force: true });
        await downloadSyncArtifact(artifact, output, manifest.fileSync.githubMirrors, reportBytes);
        method = 'full'; downloadBytes += artifact.size;
      }
    }
    if ((await fsp.stat(output)).size !== file.size || await hashFile(output) !== file.sha256) throw new Error(`客户端文件校验失败: ${file.path}`);
    if (method === 'delta' || method === 'full') await storeClientUpdateCache(root, file, output);
    transferSummary.push({ path: file.path, method, bytes: downloadBytes });
    await fsp.writeFile(path.join(stage, 'download-summary.json'), JSON.stringify({
      note: 'Verified payload bytes; excludes metadata and incomplete transport attempts', files: transferSummary,
    }, null, 2));
    console.log('[ClientUpdate]', method, file.path, downloadBytes);
    files.push({ path: file.path, oldSha256: oldHash, newSha256: file.sha256, newSize: file.size, method: 'replace', artifact });
    onProgress?.(`已校验 ${file.path}`, index + 1, selected.size + 1);
  }
  // Persist the new official metadata in the SAME rollback transaction as the binaries.
  assertNoLinks(root, CLIENT_SNAPSHOT_PATH);
  const snapshotPath = path.join(root, ...CLIENT_SNAPSHOT_PATH.split('/'));
  const compressed = encodeSnapshot(latest);
  const nextSnapshot = path.join(stage, 'new', ...CLIENT_SNAPSHOT_PATH.split('/'));
  await fsp.mkdir(path.dirname(nextSnapshot), { recursive: true });
  await fsp.writeFile(nextSnapshot, compressed);
  files.push({ path: CLIENT_SNAPSHOT_PATH, oldSha256: fs.existsSync(snapshotPath) ? await hashFile(snapshotPath) : null,
    newSha256: crypto.createHash('sha256').update(compressed).digest('hex'), newSize: compressed.length, method: 'replace',
    artifact: { size: compressed.length, sha256: crypto.createHash('sha256').update(compressed).digest('hex'), sources: manifest.fileSync.inventory.sources } });
  onProgress?.('客户端变化文件已准备完成', files.length, files.length);
  return files;
}

/** Legacy metadata may describe a delta, but only a matching local file is its dictionary.
 * The helper receives the ACTUAL pre-update hashes, so rollback restores this installation,
 * not the publisher's baseline. Staging never changes the running application. */
export async function stageLegacyClientUpdate(
  manifest: ClientUpdateManifest, root: string, stage: string,
  onProgress?: ClientProgress,
): Promise<ClientUpdateFile[]> {
  if (manifest.schema !== 1) throw new Error('not a legacy client release');
  const files: ClientUpdateFile[] = [];
  for (const [index, file] of manifest.files.entries()) {
    assertNoLinks(root, file.path);
    const installed = path.join(root, ...file.path.split('/'));
    const oldHash = fs.existsSync(installed) ? await hashFile(installed) : null;
    const output = path.join(stage, 'new', ...file.path.split('/'));
    await fsp.mkdir(path.dirname(output), { recursive: true });
    onProgress?.(`正在准备 ${file.path}`, index, manifest.files.length);
    let fileProgress = 0;
    const reportBytes: DownloadProgress = (completedBytes, totalBytes) => {
      fileProgress = Math.max(fileProgress, Math.min(0.95, 0.95 * completedBytes / (totalBytes || 1)));
      onProgress?.(`正在下载 ${file.path}`, index + fileProgress, manifest.files.length, { completedBytes, totalBytes });
    };
    let ready = oldHash === file.newSha256;
    if (ready) await fsp.copyFile(installed, output);
    else if (file.method === 'zstd-delta' && oldHash !== null && oldHash === file.oldSha256) {
      try {
        const delta = path.join(stage, 'artifacts', String(index) + '.zst');
        await download(file, delta, [], reportBytes);
        await reconstruct(installed, delta, output);
        ready = (await fsp.stat(output)).size === file.newSize && await hashFile(output) === file.newSha256;
        if (!ready) throw new Error(`重建校验失败: ${file.path}`);
      } catch (error) {
        if (!file.fullArtifact) throw error;
        console.warn('[ClientUpdate] Optional delta failed; using the full signed file:', file.path);
      }
    }
    if (!ready) {
      const artifact = file.method === 'replace' ? file.artifact : file.fullArtifact;
      if (!artifact) throw new Error(`此旧补丁仅提供差分，本地 ${file.path} 与差分基线不同；请覆盖安装最新版便携客户端。不会强行应用不匹配的差分。`);
      onProgress?.(`正在下载完整目标文件 ${file.path}`, index + fileProgress, manifest.files.length);
      await fsp.rm(output, { force: true });
      await downloadSyncArtifact(artifact, output, [], reportBytes);
    }
    if ((await fsp.stat(output)).size !== file.newSize || await hashFile(output) !== file.newSha256) throw new Error(`客户端文件校验失败: ${file.path}`);
    files.push({ ...file, oldSha256: oldHash });
    onProgress?.(`已校验 ${file.path}`, index + 1, manifest.files.length);
  }
  return files;
}
export async function prepareClientUpdate(onProgress?: ClientProgress): Promise<void> {
  if (preparing) throw new Error('客户端更新已经进行中');
  preparing = true;
  let stage = '';
  let createdHelperExe = '';
  let activePath = '';
  let phase = 'checking';
  let targetVersion: string | undefined;
  try {
    if (!await gateAllows()) throw new Error('此更新尚未公开');
    const manifest = await fetchManifest();
    targetVersion = manifest.targetVersion;
    if (manifest.schema === 1 && manifest.baseVersion !== app.getVersion()) throw new Error('没有适用于当前客户端版本的增量包');
    if (manifest.schema === 2 && manifest.runtimeVersion !== process.versions.electron) throw new Error('Electron 内核变化，请下载新的便携客户端');
    const root = path.dirname(process.execPath);
    const management = path.join(root, '.quenching-client-update');
    if (fs.existsSync(management) && fs.lstatSync(management).isSymbolicLink()) throw new Error('更新目录是链接');
    await fsp.mkdir(management, { recursive: true });
    activePath = path.join(management, 'active.json');
    if (fs.existsSync(activePath)) throw new Error('有尚未完成的客户端更新事务，请先恢复');
    let required = manifest.files.reduce((sum, file) => sum + file.artifact.size + (file.fullArtifact?.size || 0) + file.newSize, 0);
    for (const file of manifest.files) {
      const installed = path.join(root, ...file.path.split('/'));
      assertNoLinks(root, file.path);
      if (fs.existsSync(installed)) required += (await fsp.stat(installed)).size;
      if (file.path === 'QMClient.exe') required += file.newSize;
    }
    const volume = await statfs(root);
    if (Number(volume.bavail) * Number(volume.bsize) < required * 1.1) throw new Error('客户端所在磁盘空间不足，无法保留回滚备份');
    stage = path.join(management, crypto.randomBytes(12).toString('hex'));
    await fsp.mkdir(stage);
    phase = 'staging';
    manifest.files = manifest.schema === 2
      ? await stageClientFileSync(manifest, root, stage, app.getVersion(), onProgress)
      : await stageLegacyClientUpdate(manifest, root, stage, onProgress);
    const token = crypto.randomBytes(16).toString('hex');
    phase = 'starting-helper';
    const relaunchArgs = process.argv.slice(1).filter(arg => arg.startsWith('--user-data-dir=') ||
      (process.env.QUENCHING_CLIENT_UPDATE_TEST === '1' && arg.startsWith('--remote-debugging-port=')));
    const plan = { root, stage, token, relaunchArgs,
      files: manifest.files.map(({ path: relative, oldSha256, newSha256 }) => ({ path: relative, oldSha256, newSha256 })) };
    const planPath = path.join(stage, 'plan.json');
    await fsp.writeFile(planPath, JSON.stringify(plan), { flag: 'wx' });
    const nextExe = path.join(root, 'QMClient.next.exe');
    if (fs.existsSync(nextExe)) throw new Error('发现上次遗留的 QMClient.next.exe；请先检查更新状态');
    await fsp.copyFile(path.join(stage, 'new', 'QMClient.exe'), nextExe, fs.constants.COPYFILE_EXCL);
    createdHelperExe = nextExe;
    const stagedHelper = path.join(stage, 'new', 'resources', 'assets', 'updater', 'client-update-helper.cjs');
    const helper = manifest.files.some(file => file.path === 'resources/assets/updater/client-update-helper.cjs')
      ? stagedHelper : path.join(process.resourcesPath, 'assets', 'updater', 'client-update-helper.cjs');
    const child = spawn(nextExe, [helper, planPath, String(process.pid)], {
      cwd: root, detached: true, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    await fsp.writeFile(activePath, JSON.stringify({ stage, token, helperPid: child.pid }), { flag: 'wx' });
    child.unref();
    // The helper performs the swap only after this process has exited.
    setTimeout(() => app.quit(), 100);
  } catch (error) {
    if (activePath) await fsp.rm(activePath, { force: true }).catch(() => undefined);
    if (createdHelperExe) await fsp.rm(createdHelperExe, { force: true }).catch(() => undefined);
    if (stage) await fsp.rm(stage, { recursive: true, force: true }).catch(() => undefined);
    await retainClientUpdateFailure(error, phase, targetVersion);
    throw error;
  } finally { preparing = false; }
}

export async function acknowledgeClientUpdate(): Promise<void> {
  const ack = process.env.QUENCHING_CLIENT_UPDATE_ACK;
  const token = process.env.QUENCHING_CLIENT_UPDATE_TOKEN;
  if (!ack || !token || !/^[a-f0-9]{32}$/.test(token)) return;
  const root = path.dirname(process.execPath);
  if (!path.resolve(ack).startsWith(path.join(root, '.quenching-client-update') + path.sep)) return;
  await fsp.writeFile(ack, token, { flag: 'wx' });
}

/** Remove only a transaction whose helper has committed and removed its rollback backup. */
export async function cleanupCompletedClientUpdate(): Promise<void> {
  if (!app.isPackaged || process.platform !== 'win32') return;
  const root = path.dirname(process.execPath);
  const management = path.join(root, '.quenching-client-update');
  if (!fs.existsSync(management) || fs.lstatSync(management).isSymbolicLink()) return;
  if (fs.existsSync(path.join(management, 'active.json'))) return;
  for (const name of await fsp.readdir(management)) {
    if (!/^[a-f0-9]{24}$/.test(name)) continue;
    const stage = path.join(management, name);
    const journal = await fsp.readFile(path.join(stage, 'journal.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (journal?.state === 'rolled-back') {
      // Keep error.txt and backups for diagnosis, but remove the running-helper
      // copy after it exits so the user can retry the update.
      await fsp.rm(path.join(root, 'QMClient.next.exe'), { force: true }).catch(() => undefined);
      continue;
    }
    if (journal?.state !== 'complete') continue;
    try {
      await fsp.rm(path.join(root, 'QMClient.next.exe'), { force: true });
      // Remove the GUI's potentially open stdout before its journal, so a
      // cleanup blocked by Windows remains discoverable on the next launch.
      await fsp.rm(path.join(stage, 'new-client.log'), { force: true });
      await fsp.rm(stage, { recursive: true, force: true });
    } catch { /* The helper may still hold its executable; retry on next start. */ }
  }
}

export async function checkInterruptedClientUpdate(): Promise<'clear' | 'healthy' | 'recovering' | 'busy'> {
  if (!app.isPackaged || process.platform !== 'win32') return 'clear';
  const root = path.dirname(process.execPath);
  const management = path.join(root, '.quenching-client-update');
  if (!fs.existsSync(management)) return 'clear';
  if (fs.lstatSync(management).isSymbolicLink()) throw new Error('client update directory is a link');
  const activePath = path.join(management, 'active.json');
  if (!fs.existsSync(activePath)) return 'clear';
  const active = JSON.parse(await fsp.readFile(activePath, 'utf8'));
  if (typeof active.stage !== 'string' || path.dirname(path.resolve(active.stage)) !== management ||
      typeof active.token !== 'string' || !/^[a-f0-9]{32}$/.test(active.token) || !Number.isInteger(active.helperPid)) throw new Error('invalid update recovery marker');
  if (process.env.QUENCHING_CLIENT_UPDATE_TOKEN === active.token) return 'healthy';
  try { process.kill(active.helperPid, 0); return 'busy'; } catch { /* Helper stopped unexpectedly. */ }
  const nextExe = path.join(root, 'QMClient.next.exe');
  const planPath = path.join(active.stage, 'plan.json');
  if (!fs.existsSync(nextExe) || !fs.existsSync(planPath)) throw new Error('update interrupted but recovery files are missing');
  const helper = path.join(process.resourcesPath, 'assets', 'updater', 'client-update-helper.cjs');
  const child = spawn(nextExe, [helper, planPath, String(process.pid), '--recover'], {
    cwd: root, detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  return 'recovering';
}
