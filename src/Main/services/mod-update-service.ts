import crypto from 'crypto';
import childProcess from 'child_process';
import fs from 'fs-extra';
import { statfs } from 'node:fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { extractZipArchive } from './zip-extraction';
import { isFullPackageInstalled, resolveRetailDir } from './full-package-service';
import { fetchReleaseGate, previewUpdatesEnabled } from './release-gate-service';
import { hasLegacy34Sentinels, resolveManagedSequence } from './mod-version-detection';
import { FileSyncDescriptor, planFileSync, syncFileArtifact, validateFileSync } from '../../shared/file-sync';
import { ModZipPatch, ModZipPolicy, planModZipChain, validateModZipPolicy } from '../../shared/mod-zip-update';
import { decodeSnapshot, encodeSnapshot } from './file-sync-snapshot';
import { downloadUpdateFile, rememberUpdateDownloadSource, SlowUpdateDownloadError, updateDownloadSources } from './update-download';
import { updateTestEnabled } from './update-channel';
import { fetchUpdateMetadata, requestUpdateMetadata } from './update-metadata';
import { updateMetadataUrls } from './update-metadata-urls';
import { reuseUpdateArtifactCache, storeUpdateArtifactCache, removeUpdateArtifactCache } from './update-artifact-cache';
import {
  loadIntegrityManifest,
  MOD_INTEGRITY_PATHS,
  ModIntegrityReport,
  integrityBackupRelativePath,
  prepareUpdatedIntegrityManifest,
  readCurrentModMarker,
  readCurrentModVersion,
  writeCurrentModVersion,
  writeUpdatedIntegrityManifest,
} from './mod-integrity-service';

const PRODUCT = 'quenching-mod';
const MIN_MANAGED_SEQUENCE = 35;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const execFile = promisify(childProcess.execFile);

export interface ModUpdatePart {
  url: string;
  size: number;
  sha256: string;
}

export type ModUpdateSource = string | { parts: ModUpdatePart[] };

export interface ModUpdateArtifact {
  id?: string;
  size: number;
  sha256: string;
  /** Ordered from preferred to fallback; full packages use external hosts. */
  sources: ModUpdateSource[];
}

export interface ModPatchArtifact extends ModUpdateArtifact {
  fromSequence: number;
  toSequence: number;
}

export interface ModUpdateManifest {
  schema: 1 | 2 | 3;
  product: typeof PRODUCT;
  sequence: number;
  version: string;
  /** Public-facing MOD version. Internal version may be 3.51 while this remains 3.5. */
  displayVersion?: string;
  generatedAt?: string;
  minClientVersion?: string;
  fullPackage?: ModUpdateArtifact;
  patches?: ModPatchArtifact[];
  fileSync?: FileSyncDescriptor;
  zipPolicy?: ModZipPolicy;
  /** Optional detached signature. Verification is enabled when a public key is configured. */
  signature?: { algorithm: 'ed25519'; keyId?: string; value: string };
}

export interface InstalledModState {
  product: typeof PRODUCT;
  sequence: number;
  version: string;
  displayVersion?: string;
  installedAt: string;
  files: string[];
  filesDigest: string;
}

export type ModUpdateDecision =
  | 'upToDate'
  | 'patch'
  | 'requiresFullPackage'
  | 'unknownInstallation'
  | 'unavailable';

export interface ModUpdateStatus {
  decision: ModUpdateDecision;
  current: InstalledModState | null;
  target: { sequence: number; version: string; displayVersion: string } | null;
  patch?: ModPatchArtifact;
  patchChain?: ModZipPatch[];
  githubMirrors?: string[];
  fileSync?: FileSyncDescriptor;
  fullPackage?: ModUpdateArtifact;
  reason: string;
  manifestSource?: string;
  integrity?: ModIntegrityReport;
}

export interface ModUpdateOptions {
  manifestUrls?: string[];
  /** Test-only override. Production should use the manifest's source URLs. */
  stagingRoot?: string;
  /** Test/publisher integration override. Never expose this through renderer IPC. */
  publicKeyPem?: string;
  /** Runtime-only progress callback. It is supplied by the main-process IPC handler. */
  onProgress?: (progress: ModUpdateProgress) => void;
}

export interface ModUpdateProgress {
  phase: 'preparing' | 'downloading' | 'verifying' | 'extracting' | 'installing' | 'finalizing' | 'complete';
  percent: number;
  message: string;
  completedBytes?: number;
  totalBytes?: number;
}

export interface ModUpdateResult {
  status: ModUpdateStatus;
  applied: boolean;
  downloadedFrom?: string;
  error?: string;
  configurationError?: string;
  /** Committed ZIP steps; a later failed step does not undo an earlier success. */
  appliedPatches?: number;
}

function manifestUrls(options?: ModUpdateOptions): string[] {
  const configured = process.env.QUENCHING_MANIFEST_URL?.trim();
  return updateTestEnabled() || !options?.manifestUrls
    ? updateMetadataUrls(['mod-zip-manifest.json', 'mod-sync-manifest.json', 'manifest.json'], configured)
    : Array.from(new Set([...(configured ? [configured] : []), ...options.manifestUrls]));
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function stableFilesDigest(files: string[]): string {
  return crypto.createHash('sha256').update(JSON.stringify([...files].sort())).digest('hex');
}

function parseJsonObject(text: string, label: string): any {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('must be an object');
    return value;
  } catch (error: any) {
    throw new Error(`${label} is not valid JSON: ${error?.message || String(error)}`);
  }
}

function canonicalJson(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

async function updatePublicKey(publicKeyPem?: string): Promise<string> {
  if (publicKeyPem?.trim()) return publicKeyPem;
  const configured = process.env.QUENCHING_UPDATE_PUBLIC_KEY?.replace(/\\n/g, '\n').trim();
  if (configured) return configured;
  const resourcesPath = (process as any).resourcesPath as string | undefined;
  const candidates = [
    resourcesPath ? path.join(resourcesPath, 'assets', 'quenching', 'update-public-key.pem') : '',
    path.join(process.cwd(), 'assets', 'quenching', 'update-public-key.pem'),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = await fs.readFile(candidate, 'utf8').catch(() => '');
    if (key.trim()) return key;
  }
  throw new Error('update public key is not configured');
}

function verifyManifestSignature(value: any, key: string): void {
  const signature = value?.signature;
  if (!signature || signature.algorithm !== 'ed25519' || typeof signature.value !== 'string') {
    throw new Error('manifest signature is missing or invalid');
  }
  const unsigned = { ...value };
  delete unsigned.signature;
  let signatureBytes: Buffer;
  try { signatureBytes = Buffer.from(signature.value, 'base64'); } catch { throw new Error('manifest signature is not base64'); }
  if (!crypto.verify(null, Buffer.from(canonicalJson(unsigned), 'utf8'), key, signatureBytes)) {
    throw new Error('manifest signature verification failed');
  }
}

function validateArtifact(value: any, label: string): ModUpdateArtifact {
  if (!value || typeof value !== 'object') throw new Error(`${label} is missing`);
  if (!Number.isSafeInteger(value.size) || value.size < 0) throw new Error(`${label}.size is invalid`);
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.sha256)) throw new Error(`${label}.sha256 is invalid`);
  if (!Array.isArray(value.sources) || value.sources.length === 0) throw new Error(`${label}.sources is invalid`);
  const sources: ModUpdateSource[] = value.sources.map((source: any, sourceIndex: number) => {
    if (typeof source === 'string' && /^https?:\/\//i.test(source)) return source;
    if (!source || typeof source !== 'object' || Array.isArray(source) || !Array.isArray(source.parts) || source.parts.length === 0 || source.parts.length > 256) {
      throw new Error(`${label}.sources[${sourceIndex}] is invalid`);
    }
    let total = 0;
    const parts: ModUpdatePart[] = source.parts.map((part: any, partIndex: number) => {
      if (!part || typeof part.url !== 'string' || !/^https?:\/\//i.test(part.url) || !Number.isSafeInteger(part.size) || part.size <= 0 || typeof part.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(part.sha256)) {
        throw new Error(`${label}.sources[${sourceIndex}].parts[${partIndex}] is invalid`);
      }
      total += part.size;
      if (!Number.isSafeInteger(total) || total > value.size) throw new Error(`${label}.sources[${sourceIndex}] exceeds artifact size`);
      return { url: part.url, size: part.size, sha256: part.sha256.toLowerCase() };
    });
    if (total !== value.size) throw new Error(`${label}.sources[${sourceIndex}] has wrong total size`);
    return { parts };
  });
  return { id: typeof value.id === 'string' ? value.id : undefined, size: value.size, sha256: value.sha256.toLowerCase(), sources };
}

function validateManifest(value: any): ModUpdateManifest {
  if (![1, 2, 3].includes(value.schema) || value.product !== PRODUCT) throw new Error('unsupported manifest schema or product');
  if (!Number.isSafeInteger(value.sequence) || value.sequence < MIN_MANAGED_SEQUENCE || typeof value.version !== 'string' || !/^\d+(?:\.\d+){1,2}$/.test(value.version)) {
    throw new Error('manifest sequence/version is invalid');
  }
  if (value.displayVersion !== undefined && (typeof value.displayVersion !== 'string' || !value.displayVersion.trim())) throw new Error('manifest displayVersion is invalid');
  const manifest: ModUpdateManifest = {
    schema: value.schema,
    product: PRODUCT,
    sequence: value.sequence,
    version: value.version,
    displayVersion: value.displayVersion ?? value.version,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : undefined,
    minClientVersion: typeof value.minClientVersion === 'string' ? value.minClientVersion : undefined,
    fullPackage: value.fullPackage ? validateArtifact(value.fullPackage, 'fullPackage') : undefined,
    patches: [],
    signature: value.signature,
  };
  if (value.schema === 3) {
    manifest.zipPolicy = validateModZipPolicy(value);
    return manifest;
  }
  if (value.schema === 2) {
    manifest.fileSync = validateFileSync(value.fileSync);
    return manifest;
  }
  if (!Array.isArray(value.patches)) throw new Error('manifest.patches is missing');
  manifest.patches = value.patches.map((patch: any, index: number) => {
    const artifact = validateArtifact(patch, `patches[${index}]`);
    if (!Number.isSafeInteger(patch.fromSequence) || !Number.isSafeInteger(patch.toSequence) || patch.toSequence <= patch.fromSequence) {
      throw new Error(`patches[${index}] sequence is invalid`);
    }
    return { ...artifact, fromSequence: patch.fromSequence, toSequence: patch.toSequence };
  });
  return manifest;
}

async function requestText(url: string, timeoutMs: number): Promise<string> {
  if (url.startsWith('file://')) return fs.readFile(new URL(url), 'utf8');
  return (await requestUpdateMetadata(url, { limit: MAX_MANIFEST_BYTES, timeoutMs, allowHttpLoopback: true })).toString('utf8');
}

export async function fetchModManifest(options?: ModUpdateOptions): Promise<{ manifest: ModUpdateManifest; source: string }> {
  const publicKey = await updatePublicKey(options?.publicKeyPem);
  try {
    return await fetchUpdateMetadata(manifestUrls(options), async (url, timeoutMs) => {
      const value = parseJsonObject(await requestText(url, timeoutMs), 'manifest');
      verifyManifestSignature(value, publicKey);
      const manifest = validateManifest(value);
      return { manifest, source: url };
    });
  } catch (error: any) {
    throw new Error(`all manifest sources failed: ${error?.message || String(error)}`);
  }
}

function lightweightState(sequence: number, version: string, displayVersion = version): InstalledModState {
  const files: string[] = [];
  return { product: PRODUCT, sequence, version, displayVersion, installedAt: '', files, filesDigest: stableFilesDigest(files) };
}

/**
 * Automatic checks read only _patch/keep.que. The 3.5 full package predates
 * sequence lines, so its one known sequence is supplied here.
 */
async function readMarkedState(war3Path: string): Promise<InstalledModState | null> {
  const marker = await readCurrentModMarker(war3Path);
  if (!marker) return null;
  const sequence = resolveManagedSequence(marker);
  if (sequence === null) return null;
  return lightweightState(sequence, marker.version, marker.displayVersion || marker.version);
}

/** 3.4 has no modern marker. Detect it with three fixed folder sentinels only. */
async function readLegacy34State(war3Path: string): Promise<InstalledModState | null> {
  if (await readCurrentModVersion(war3Path)) return null;
  const retailDir = await resolveRetailDir(war3Path);
  return await hasLegacy34Sentinels(retailDir) ? lightweightState(34, '3.4') : null;
}

export async function writeInstalledModState(war3Path: string, state: InstalledModState): Promise<void> {
  const retailDir = await resolveRetailDir(war3Path);
  const statePath = path.join(retailDir, '.quenching', 'installed-mod.json');
  await fs.ensureDir(path.dirname(statePath));
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeJson(temporaryPath, state, { spaces: 2 });
    // Same-volume replace must preserve the previous state if Windows refuses
    // the rename; fs.move(overwrite) first removes that previous state.
    await fs.rename(temporaryPath, statePath);
  } finally {
    await fs.remove(temporaryPath).catch(() => undefined);
  }
}

function normalizeRelativePath(value: string): string {
  if (typeof value !== 'string') throw new Error('path must be a string');
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`unsafe relative path: ${value}`);
  }
  if (normalized.split('/').some((segment) => segment.toLowerCase() === '.quenching')) {
    throw new Error(`patch cannot modify updater management files: ${value}`);
  }
  return normalized;
}

function assertPatchResourcePath(relative: string): void {
  const lower = relative.toLowerCase();
  if (lower === MOD_INTEGRITY_PATHS.keep.toLowerCase() || /^_patch\/qmf-[^/]+\.files\.json\.gz$/.test(lower)) {
    throw new Error(`patch cannot modify updater metadata: ${relative}`);
  }
}

export async function assertWarcraftNotRunning(): Promise<void> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFile('tasklist.exe', ['/FI', 'IMAGENAME eq Warcraft III.exe', '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      if (stdout.toLowerCase().includes('warcraft iii.exe')) throw new Error('Warcraft III is running; close the game before updating');
      return;
    }
    const { stdout } = await execFile('ps', ['-A', '-o', 'comm='], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const running = stdout.split(/\r?\n/).some((command) => path.basename(command.trim()).toLowerCase().replace(/\.exe$/, '') === 'warcraft iii');
    if (running) throw new Error('Warcraft III is running; close the game before updating');
  } catch (error: any) {
    if (String(error?.message || error).includes('Warcraft III is running')) throw error;
    throw new Error(`cannot verify whether Warcraft III is running: ${error?.message || String(error)}`);
  }
}

function resolveSafe(root: string, relative: string): string {
  const normalized = normalizeRelativePath(relative);
  const rootResolved = path.resolve(root);
  const target = path.resolve(rootResolved, normalized);
  if (target !== rootResolved && !target.startsWith(`${rootResolved}${path.sep}`)) throw new Error(`unsafe target path: ${relative}`);
  return target;
}

export async function getModUpdateStatus(war3Path: string, options?: ModUpdateOptions): Promise<ModUpdateStatus> {
  let fetched: { manifest: ModUpdateManifest; source: string };
  try {
    fetched = await fetchModManifest(options);
  } catch (error: any) {
    const reason = String(error?.message || error);
    if (/manifest signature (?:verification failed|is missing or invalid|is not base64)/.test(reason)) {
      throw error;
    }
    if (reason === 'update public key is not configured' || reason.startsWith('all manifest sources failed:')) {
      return { decision: 'unavailable', current: await readMarkedState(war3Path) || await readLegacy34State(war3Path), target: null, reason };
    }
    throw error;
  }
  const { manifest, source } = fetched;
  // The signed manifest authenticates patch contents; version.que separately
  // controls when that already-staged release becomes publicly actionable.
  // Explicit test options and internal preview launches are the only bypasses.
  if (!options?.manifestUrls && !options?.publicKeyPem && !previewUpdatesEnabled()) {
    try {
      const { gate } = await fetchReleaseGate();
      const displayVersion = manifest.displayVersion || manifest.version;
      if (gate.allowed === 0 || gate.modVersion !== displayVersion) {
        return {
          decision: 'unavailable', current: await readMarkedState(war3Path) || await readLegacy34State(war3Path), target: null,
          reason: gate.allowed === 0 ? `${gate.version} is staged but not public` :
            `version.que allows MOD ${gate.modVersion}, not ${displayVersion}`,
          manifestSource: source,
        };
      }
    } catch (error: any) {
      return { decision: 'unavailable', current: await readMarkedState(war3Path) || await readLegacy34State(war3Path), target: null,
        reason: `release gate unavailable: ${error?.message || String(error)}`, manifestSource: source };
    }
  }
  let current = await readMarkedState(war3Path);
  if (!current) current = await readLegacy34State(war3Path);
  const target = { sequence: manifest.sequence, version: manifest.version, displayVersion: manifest.displayVersion || manifest.version };
  if (!current) {
    const complete = await isFullPackageInstalled(war3Path);
    return {
      decision: complete ? 'unknownInstallation' : 'requiresFullPackage',
      current: null,
      target,
      fullPackage: manifest.fullPackage,
      reason: complete ? 'full package exists but its managed version is unknown' : 'no managed full package is installed',
      manifestSource: source,
    };
  }
  if (current.sequence < MIN_MANAGED_SEQUENCE && current.sequence !== 34) {
    return { decision: 'requiresFullPackage', current, target, fullPackage: manifest.fullPackage, reason: 'no migration exists for this MOD version', manifestSource: source };
  }
  if (current.sequence >= manifest.sequence) {
    return { decision: 'upToDate', current, target, reason: 'installed MOD is current', manifestSource: source };
  }
  if (manifest.zipPolicy) {
    const plan = planModZipChain(current, target, manifest.zipPolicy);
    return { decision: plan.reason ? 'requiresFullPackage' : 'patch', current, target,
      patchChain: plan.reason ? undefined : plan.patches, githubMirrors: manifest.zipPolicy.githubMirrors,
      fullPackage: manifest.fullPackage, reason: plan.reason || `${plan.patches.length} successive MOD ZIP patches are available`, manifestSource: source };
  }
  if (manifest.fileSync) {
    return { decision: 'patch', current, target, fileSync: manifest.fileSync, reason: 'latest official file synchronization is available', manifestSource: source };
  }
  const patch = manifest.patches
    ?.filter((item) => item.fromSequence <= current.sequence && item.toSequence === manifest.sequence)
    .sort((a, b) => b.fromSequence - a.fromSequence)[0];
  if (!patch) {
    return { decision: 'requiresFullPackage', current, target, fullPackage: manifest.fullPackage, reason: 'no compatible cumulative patch is published for this installed sequence', manifestSource: source };
  }
  return { decision: 'patch', current, target, patch, reason: `cumulative patch from baseline ${patch.fromSequence} is available`, manifestSource: source };
}

async function downloadArtifact(
  artifact: ModUpdateArtifact,
  destination: string,
  onDownload?: (completed: number, total: number) => void,
  onVerifying?: () => void,
  githubMirrors: readonly string[] = [],
  cacheRoot?: string,
): Promise<string> {
  const errors: string[] = [];
  await fs.ensureDir(path.dirname(destination));
  if (cacheRoot && await reuseUpdateArtifactCache(cacheRoot, artifact, destination, 'mod')) {
    onVerifying?.(); onDownload?.(artifact.size, artifact.size);
    return `verified-cache:${artifact.sha256}`;
  }
  const partPath = `${destination}.part`;
  const sources = updateDownloadSources(artifact.sources, githubMirrors);
  for (const [sourceIndex, source] of sources.entries()) {
    const slowFallback = sourceIndex < sources.length - 1;
    const label = typeof source === 'string' ? source : `chunked:${source.parts[0].url}`;
    try {
      await fs.ensureDir(path.dirname(destination));
      if (typeof source === 'string' && source.startsWith('file://')) {
        await fs.copyFile(fileURLToPath(source), destination);
        onDownload?.(artifact.size, artifact.size);
      } else if (typeof source === 'string') {
        await downloadUpdateFile(source, destination, artifact.size, {
          slowFallback, allowHttpLoopback: true, onProgress: received => onDownload?.(received, artifact.size),
        });
      } else {
        let completed = 0;
        for (const part of source.parts) {
          for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
              await downloadUpdateFile(part.url, partPath, part.size, {
                slowFallback, allowHttpLoopback: true, onProgress: received => onDownload?.(completed + received, artifact.size),
              });
              const partStat = await fs.stat(partPath);
              if (partStat.size !== part.size) throw new Error(`part size mismatch: expected ${part.size}, got ${partStat.size}`);
              const partHash = await sha256File(partPath);
              if (partHash !== part.sha256) throw new Error(`part sha256 mismatch: expected ${part.sha256}, got ${partHash}`);
              break;
            } catch (error) {
              await fs.remove(partPath).catch(() => undefined);
              if (error instanceof SlowUpdateDownloadError || attempt === 3) throw error;
              await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
            }
          }
          await pipeline(fs.createReadStream(partPath), fs.createWriteStream(destination, { flags: 'a' }));
          await fs.remove(partPath);
          completed += part.size;
          onDownload?.(completed, artifact.size);
        }
      }
      const stat = await fs.stat(destination);
      if (stat.size !== artifact.size) throw new Error(`size mismatch: expected ${artifact.size}, got ${stat.size}`);
      onVerifying?.();
      const hash = await sha256File(destination);
      if (hash !== artifact.sha256.toLowerCase()) throw new Error(`sha256 mismatch: expected ${artifact.sha256}, got ${hash}`);
      if (cacheRoot) await storeUpdateArtifactCache(cacheRoot, artifact, destination, 'mod');
      rememberUpdateDownloadSource(source, githubMirrors);
      return label;
    } catch (error: any) {
      const detail = `${label}: ${error?.message || String(error)}`;
      errors.push(detail);
      console.warn(`[mod-update] source failed; trying next source if available: ${detail}`);
      await fs.remove(destination).catch(() => undefined);
      await fs.remove(partPath).catch(() => undefined);
    }
  }
  throw new Error(`all artifact sources failed: ${errors.join('; ')}`);
}

interface PatchFileRecord {
  path: string;
  size: number;
  sha256: string;
  previousSha256?: string | null;
  acceptedPreviousSha256?: string[];
  allowMissing?: boolean;
}
interface PatchDeleteRecord {
  path: string;
  previousSha256?: string;
  acceptedPreviousSha256?: string[];
  allowMissing?: boolean;
}
interface PatchDocument { schema: 1; product: typeof PRODUCT; fromSequence: number; toSequence: number;
  fromVersion?: string; version?: string; files: PatchFileRecord[]; deleted?: PatchDeleteRecord[] }

async function assertPatchSpace(unpackedBytes: number, gameDir: string): Promise<void> {
  const stats = await statfs(gameDir);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  // The archive has already been unpacked; reserve one more copy for
  // originals/rollback, plus a fixed safety margin.
  const requiredBytes = unpackedBytes + 512 * 1024 ** 2;
  if (!Number.isSafeInteger(requiredBytes) || freeBytes < requiredBytes) {
    throw new Error(`Insufficient game-drive space for MOD update: need at least ${
      (requiredBytes / 1024 ** 3).toFixed(1)} GiB free after download; available ${
      (freeBytes / 1024 ** 3).toFixed(1)} GiB`);
  }
}

async function applyPatchArchive(
  archivePath: string,
  war3Path: string,
  current: InstalledModState,
  target: { sequence: number; version: string; displayVersion: string },
  stagingRoot: string,
  checkSpace: boolean,
  onProgress?: (percent: number, message: string) => void,
  zipPatch?: ModZipPatch,
): Promise<void> {
  let lastProgressPercent = -1;
  let lastProgressMessage = '';
  const progress = (percent: number, message: string) => {
    const rounded = Math.max(0, Math.min(100, Math.round(percent)));
    if (rounded === lastProgressPercent && message === lastProgressMessage) return;
    lastProgressPercent = rounded;
    lastProgressMessage = message;
    try { onProgress?.(rounded, message); } catch (error) { console.warn('[ModUpdate] Progress listener failed:', error); }
  };
  const legacy34 = current.sequence === 34 && current.version === '3.4';
  const patchRoot = path.join(stagingRoot, 'patch');
  await fs.remove(patchRoot);
  progress(0, '正在解压 MOD 更新包');
  const unpackedBytes = await extractZipArchive(archivePath, patchRoot, {
    onProgress: (percent) => progress(percent * 0.3, '正在解压 MOD 更新包'),
  });
  progress(34, '正在校验更新内容');
  let inventory: Buffer | undefined;
  if (zipPatch) {
    const document: PatchDocument = await fs.readJson(path.join(patchRoot, 'patch.json'));
    if (document.fromSequence !== current.sequence || document.fromVersion !== current.version ||
        document.toSequence !== target.sequence || document.version !== target.version) {
      throw new Error('ZIP patch does not match this exact resource release step');
    }
    inventory = await fs.readFile(path.join(patchRoot, 'inventory.json.gz'));
    const latest = decodeSnapshot(inventory, PRODUCT, target.version);
    if (latest.sequence !== target.sequence) throw new Error('ZIP inventory sequence does not match release');
    const records = new Map(latest.files.map(file => [file.path.toLowerCase(), file]));
    for (const file of document.files) {
      const relative = normalizeRelativePath(file.path);
      const official = records.get(relative.toLowerCase());
      if (!official || file.size !== official.size || file.sha256 !== official.sha256 ||
          (await fs.stat(resolveSafe(path.join(patchRoot, 'payload'), relative))).size !== file.size ||
          await sha256File(resolveSafe(path.join(patchRoot, 'payload'), relative)) !== file.sha256) {
        throw new Error(`ZIP payload does not match its official inventory: ${relative}`);
      }
    }
    if ((document.deleted || []).some(file => records.has(file.path.toLowerCase()))) throw new Error('ZIP deletes a file still in its target inventory');
  }
  await applyPatchDirectory(patchRoot, war3Path, current, target, checkSpace, unpackedBytes, progress, inventory, !!zipPatch);
}

async function applyPatchDirectory(
  patchRoot: string, war3Path: string, current: InstalledModState,
  target: { sequence: number; version: string; displayVersion: string },
  checkSpace: boolean, unpackedBytes: number,
  progress: (percent: number, message: string) => void,
  officialInventory?: Buffer,
  preserveParkedLayout = false,
): Promise<void> {
  const legacy34 = current.sequence === 34 && current.version === '3.4';
  if (checkSpace) await assertPatchSpace(unpackedBytes, await resolveRetailDir(war3Path));
  const patchPath = path.join(patchRoot, 'patch.json');
  const document = JSON.parse(await fs.readFile(patchPath, 'utf8')) as PatchDocument;
  if (document.schema !== 1 || document.product !== PRODUCT || document.fromSequence > current.sequence || document.toSequence !== target.sequence) {
    throw new Error('patch metadata does not match installed and target sequences');
  }
  if (!Array.isArray(document.files)) throw new Error('patch files are missing');
  const retailDir = await resolveRetailDir(war3Path);
  // Inspect only affected paths, not the player's resource tree. Preserve SD/QMoff placement.
  const fileTargets = new Map<string, string>();
  for (const file of document.files) {
    const relative = normalizeRelativePath(file.path);
    const parked = `QMoff/${relative}`;
    fileTargets.set(relative, preserveParkedLayout && !await fs.pathExists(resolveSafe(retailDir, relative)) &&
      await fs.pathExists(resolveSafe(retailDir, parked)) ? parked : relative);
  }
  const payloadRoot = path.join(patchRoot, 'payload');
  const files = document.files.map((item) => ({ ...item, path: normalizeRelativePath(item.path) }));
  for (const item of files) {
    assertPatchResourcePath(item.path);
    if (!(await fs.pathExists(resolveSafe(payloadRoot, item.path)))) throw new Error(`patch payload is missing: ${item.path}`);
  }
  const deletedRecords = (document.deleted ?? []).map((item) => ({ ...item, path: normalizeRelativePath(item.path) }));
  for (const item of deletedRecords) assertPatchResourcePath(item.path);
  const deleted = deletedRecords.map((item) => item.path);
  const deleteOnDisk: string[] = [];
  for (const item of deletedRecords) {
    for (const relative of preserveParkedLayout ? [item.path, `QMoff/${item.path}`] : [item.path]) {
      const absolute = resolveSafe(retailDir, relative);
      const stat = await fs.lstat(absolute).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
        throw error;
      });
      if (!stat) continue;
      if (!stat.isFile() || stat.isSymbolicLink()) {
        console.warn(`[ModUpdate] Preserved non-file at deleted managed path: ${item.path}`);
        continue;
      }
      const accepted = new Set([item.previousSha256, ...(item.acceptedPreviousSha256 ?? [])]
        .filter((hash): hash is string => typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash))
        .map((hash) => hash.toLowerCase()));
      if (accepted.size === 0) throw new Error(`patch deletion has no trusted previous hash: ${item.path}`);
      const existingHash = await sha256File(absolute);
      if (accepted.has(existingHash)) deleteOnDisk.push(relative);
      else console.warn(`[ModUpdate] Preserved player-modified file removed from the official package: ${item.path}`);
    }
  }
  const nextIntegrity = officialInventory || await prepareUpdatedIntegrityManifest(
    war3Path,
    current.version,
    current.sequence,
    target.version,
    target.displayVersion,
    target.sequence,
    files.map(({ path: filePath, size, sha256 }) => ({ path: filePath, size, sha256 })),
    deleted,
  );
  // Re-check immediately before the first write, so a running game never sees a partial MOD tree.
  await assertWarcraftNotRunning();
  const updateRoot = path.join(retailDir, '.quenching', 'updates');
  const backupRoot = path.join(updateRoot, `backup-${current.sequence}-${target.sequence}-${Date.now()}`);
  const journalPath = path.join(updateRoot, 'apply-journal.json');
  const touched = [...new Set([...fileTargets.values(), ...deleteOnDisk, MOD_INTEGRITY_PATHS.keep, integrityBackupRelativePath(target.version), ...(legacy34 ? ['patch/keep.que'] : [])])];
  const existedBefore = new Set<string>();
  // Populate before backing up: a failed backup must never delete an existing,
  // not-yet-backed-up player file during rollback.
  for (const relative of touched) if (await fs.pathExists(resolveSafe(retailDir, relative))) existedBefore.add(relative);
  await fs.ensureDir(backupRoot);
  await fs.writeJson(journalPath, { product: PRODUCT, fromSequence: current.sequence, toSequence: target.sequence, touched, backupRoot, createdAt: new Date().toISOString() }, { spaces: 2 });
  try {
    for (let index = 0; index < touched.length; index += 1) {
      const relative = touched[index];
      const existing = resolveSafe(retailDir, relative);
      if (await fs.pathExists(existing)) {
        existedBefore.add(relative);
        const backup = resolveSafe(backupRoot, relative);
        await fs.ensureDir(path.dirname(backup));
        await fs.copy(existing, backup, { overwrite: true });
      }
      progress(40 + (index + 1) / Math.max(touched.length, 1) * 25, '正在备份将被更新的文件');
    }
    for (let index = 0; index < files.length; index += 1) {
      const item = files[index];
      const targetPath = resolveSafe(retailDir, fileTargets.get(item.path)!);
      await fs.ensureDir(path.dirname(targetPath));
      await fs.copy(resolveSafe(payloadRoot, item.path), targetPath, { overwrite: true });
      progress(65 + (index + 1) / Math.max(files.length, 1) * 30, '正在安装 MOD 更新');
    }
    for (const relative of deleteOnDisk) await fs.remove(resolveSafe(retailDir, relative));
    if (legacy34) await fs.remove(resolveSafe(retailDir, 'patch/keep.que'));
    await writeUpdatedIntegrityManifest(war3Path, target.version, nextIntegrity);
    await writeCurrentModVersion(war3Path, target.version, target.sequence, target.displayVersion);
    progress(98, '正在写入版本信息');
    const nextFiles = officialInventory
      ? decodeSnapshot(officialInventory, PRODUCT, target.version).files.map(file => file.path).sort()
      : [...new Set([...current.files.map(normalizeRelativePath), ...files.map((item) => item.path)].filter((item) => !deleted.includes(item)))].sort();
    await writeInstalledModState(war3Path, { product: PRODUCT, sequence: target.sequence, version: target.version, displayVersion: target.displayVersion, installedAt: new Date().toISOString(), files: nextFiles, filesDigest: stableFilesDigest(nextFiles) });
    // The transaction is committed once the state marker is atomically moved.
    // Cleanup failures are harmless and must not roll files back behind the new marker.
    await fs.remove(journalPath).catch(() => undefined);
    if (legacy34) await fs.rmdir(path.join(retailDir, 'patch')).catch(() => undefined);
    else await fs.remove(backupRoot).catch(() => undefined);
  } catch (error) {
    for (const relative of touched) {
      const backup = resolveSafe(backupRoot, relative);
      const targetPath = resolveSafe(retailDir, relative);
      if (await fs.pathExists(backup)) await fs.copy(backup, targetPath, { overwrite: true });
      else if (!existedBefore.has(relative)) await fs.remove(targetPath);
    }
    throw error;
  }
}

export async function applyModUpdate(war3Path: string, options?: ModUpdateOptions): Promise<ModUpdateResult> {
  const report = (phase: ModUpdateProgress['phase'], percent: number, message: string, completedBytes?: number, totalBytes?: number) => {
    try { options?.onProgress?.({ phase, percent: Math.max(0, Math.min(100, Math.round(percent))), message, completedBytes, totalBytes }); }
    catch (error) { console.warn('[ModUpdate] Progress listener failed:', error); }
  };
  report('preparing', 0, '正在准备 MOD 更新');
  const status = await getModUpdateStatus(war3Path, options);
  if (status.decision !== 'patch' || (!status.patch && !status.fileSync && !status.patchChain?.length) || !status.current || !status.target) return { status, applied: false };
  // A portable Warcraft install may live on a roomy game drive while the
  // system drive is nearly full. Keep download/extraction staging beside the
  // selected branch, and never spill a large patch into os.tmpdir by default.
  const retailDir = await resolveRetailDir(war3Path);
  const base = options?.stagingRoot || path.join(retailDir, '.quenching', 'update-staging');
  const runRoot = path.join(base, `${status.current.sequence}-to-${status.target.sequence}-${Date.now()}`);
  const archivePath = path.join(runRoot, 'patch.qdelta');
  let appliedPatches = 0;
  try {
    await assertWarcraftNotRunning();
    report('preparing', 3, '正在读取已安装版本');
    if (status.patchChain) {
      // Each ZIP authenticates its complete target inventory. No old list or
      // filesystem-wide matching is needed to qualify for an update.
      let current = status.current;
      let completedBytes = 0;
      let highPercent = 3;
      const totalBytes = status.patchChain.reduce((sum, patch) => sum + patch.size, 0);
      const sources: string[] = [];
      for (const [index, patch] of status.patchChain.entries()) {
        const stepRoot = path.join(runRoot, `step-${index}`);
        const stepArchive = path.join(stepRoot, 'update.zip');
        const label = `MOD ${patch.fromVersion} → ${patch.displayVersion} (${index + 1}/${status.patchChain.length})`;
        const stepProgress = (phase: ModUpdateProgress['phase'], fraction: number, message: string, bytes = completedBytes) => {
          highPercent = Math.max(highPercent, 5 + (index + fraction) / status.patchChain!.length * 94);
          report(phase, highPercent, `${label} · ${message}`, bytes, totalBytes);
        };
        sources.push(await downloadArtifact(patch, stepArchive,
          received => stepProgress('downloading', received / Math.max(patch.size, 1) * 0.7, '正在下载 ZIP 补丁', completedBytes + received),
          () => stepProgress('verifying', 0.7, '正在校验 ZIP 补丁', completedBytes + patch.size), status.githubMirrors, retailDir));
        completedBytes += patch.size;
        const target = { sequence: patch.toSequence, version: patch.version, displayVersion: patch.displayVersion };
        await applyPatchArchive(stepArchive, war3Path, current, target, stepRoot, !options?.stagingRoot,
          (percent, message) => stepProgress(percent < 34 ? 'extracting' : percent < 98 ? 'installing' : 'finalizing', 0.7 + percent * 0.003, message), patch);
        appliedPatches++;
        current = lightweightState(target.sequence, target.version, target.displayVersion);
        await removeUpdateArtifactCache(retailDir, patch, 'mod');
        await fs.remove(stepRoot).catch(() => undefined);
      }
      report('complete', 100, 'MOD 更新完成', totalBytes, totalBytes);
      return { status, applied: true, appliedPatches, downloadedFrom: sources.join('; ') };
    }
    // The full file list is deliberately loaded only after the player has
    // accepted the update. It never participates in automatic version checks.
    let baseline = await loadIntegrityManifest(war3Path, status.current.version);
    if (!baseline && status.fileSync?.baselines?.[status.current.version]) {
      await fs.ensureDir(runRoot);
      const previousPath = path.join(runRoot, 'previous.files.json.gz');
      await downloadArtifact(status.fileSync.baselines[status.current.version], previousPath, undefined, undefined, status.fileSync.githubMirrors);
      const snapshot = decodeSnapshot(await fs.readFile(previousPath), PRODUCT, status.current.version);
      baseline = { manifest: snapshot, source: previousPath } as typeof baseline;
    }
    if (!baseline || baseline.manifest.sequence !== status.current.sequence) {
      throw new Error(`no trusted file list is available for installed MOD ${status.current.version}`);
    }
    const managedFiles = baseline.manifest.files.map((file) => file.path);
    const current = {
      ...status.current,
      installedAt: baseline.manifest.generatedAt,
      files: managedFiles,
      filesDigest: stableFilesDigest(managedFiles),
    };
    if (status.fileSync) {
      await fs.ensureDir(runRoot);
      const inventoryPath = path.join(runRoot, 'latest.files.json.gz');
      report('preparing', 4, '正在读取最新官方文件清单');
      await downloadArtifact(status.fileSync.inventory, inventoryPath, undefined, undefined, status.fileSync.githubMirrors);
      const latest = decodeSnapshot(await fs.readFile(inventoryPath), PRODUCT, status.target.version);
      if (latest.sequence !== status.target.sequence) throw new Error('snapshot sequence does not match signed release');
      for (const file of latest.files) assertPatchResourcePath(file.path);
      const plan = planFileSync(baseline.manifest.files, latest.files);
      const patchRoot = path.join(runRoot, 'patch');
      const oldFiles = new Map(baseline.manifest.files.map(file => [file.path.toLowerCase(), file]));
      let completed = 0;
      for (const file of plan.changed) {
        assertPatchResourcePath(file.path);
        const destination = resolveSafe(path.join(patchRoot, 'payload'), file.path);
        await downloadArtifact(syncFileArtifact(file, status.fileSync), destination, received =>
          report('downloading', 5 + (completed + received) / Math.max(plan.downloadBytes, 1) * 65,
            `正在下载变化文件 ${file.path}`, completed + received, plan.downloadBytes), undefined, status.fileSync.githubMirrors);
        completed += file.size;
      }
      // Only explicit signed retirements that belonged to this official snapshot are eligible.
      const latestPaths = new Set(latest.files.map(file => file.path.toLowerCase()));
      const deleted = (status.fileSync.deleted || []).filter(file => !latestPaths.has(file.path.toLowerCase()) && oldFiles.has(file.path.toLowerCase()))
        .map(file => ({ path: file.path, acceptedPreviousSha256: file.acceptedSha256 }));
      await fs.ensureDir(patchRoot);
      await fs.writeJson(path.join(patchRoot, 'patch.json'), { schema: 1, product: PRODUCT,
        fromSequence: current.sequence, toSequence: status.target.sequence, files: plan.changed, deleted });
      await applyPatchDirectory(patchRoot, war3Path, current, status.target, !options?.stagingRoot, plan.downloadBytes,
        (percent, message) => report(percent < 98 ? 'installing' : 'finalizing', 74 + percent * 0.25, message), encodeSnapshot(latest));
      report('complete', 100, `MOD 更新完成，补全 ${plan.changed.length} 个文件`);
      return { status, applied: true, downloadedFrom: status.manifestSource };
    }
    const downloadedFrom = await downloadArtifact(
      status.patch!,
      archivePath,
      (completed, total) => report('downloading', 5 + completed / Math.max(total, 1) * 65, '正在下载 MOD 更新', completed, total),
      () => report('verifying', 72, '正在校验下载文件', status.patch?.size, status.patch?.size),
      undefined, retailDir,
    );
    await applyPatchArchive(
      archivePath,
      war3Path,
      current,
      status.target,
      runRoot,
      !options?.stagingRoot,
      (percent, message) => report(percent < 34 ? 'extracting' : percent < 98 ? 'installing' : 'finalizing', 74 + percent * 0.25, message),
    );
    report('complete', 100, 'MOD 更新完成');
    await removeUpdateArtifactCache(retailDir, status.patch!, 'mod');
    return { status, applied: true, downloadedFrom };
  } catch (error: any) {
    const current = appliedPatches ? await getInstalledModState(war3Path) : status.current;
    return { status: { ...status, current }, applied: false, appliedPatches, error: error?.message || String(error) };
  } finally {
    await fs.remove(runRoot).catch(() => undefined);
  }
}

export async function getInstalledModState(war3Path: string): Promise<InstalledModState | null> {
  return await readMarkedState(war3Path) || await readLegacy34State(war3Path);
}

export const MOD_UPDATE_DEFAULTS = { product: PRODUCT, minManagedSequence: MIN_MANAGED_SEQUENCE,
  get manifestUrls() { return updateMetadataUrls(['mod-zip-manifest.json', 'mod-sync-manifest.json', 'manifest.json']); } } as const;
