import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SyncSource } from '../../shared/file-sync';
import { getUpdateResponse } from './update-network';

// Only transport public Release assets. Never send metadata, R2 URLs or credentials
// to a third-party proxy; the signed manifest remains the source of file hashes.
// Mirror addresses are supplied by the verified website manifest, never this binary.
let preferredGithubMirror: string | undefined;
let preferredMirrorPolicy = '';

function canMirrorGithubRelease(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://github.com' || parsed.username || parsed.password || parsed.search || parsed.hash ||
        !/^\/(?:UIZorrot|QuenchingCommunity)\/Quenching-(?:Client|Assets)\/releases\/download\/[^/]+\/[^/]+$/.test(parsed.pathname)) return false;
    return true;
  } catch { return false; }
}

export function updateDownloadSources(sources: SyncSource[], githubMirrors: readonly string[] = []): SyncSource[] {
  const expanded = sources.flatMap<SyncSource>(source => {
    if (typeof source !== 'string') return [source];
    if (!canMirrorGithubRelease(source)) return [source];
    const mirrors = githubMirrors.map(base => base + source);
    const preferred = preferredGithubMirror && preferredMirrorPolicy === JSON.stringify(githubMirrors) && githubMirrors.includes(preferredGithubMirror);
    return [...new Set(preferred ? [preferredGithubMirror + source, source, ...mirrors] : [source, ...mirrors])];
  });
  const seen = new Set<string>();
  return expanded.filter(source => {
    const key = JSON.stringify(source);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

// Called only after the entire artifact (including joined parts) passed verification.
export function rememberUpdateDownloadSource(source: SyncSource, githubMirrors: readonly string[] = []): void {
  if (typeof source !== 'string') return;
  const base = githubMirrors.find(base => source.startsWith(base) && canMirrorGithubRelease(source.slice(base.length)));
  if (base) { preferredGithubMirror = base; preferredMirrorPolicy = JSON.stringify(githubMirrors); }
}

export class SlowUpdateDownloadError extends Error {
  constructor() { super('下载持续过慢，尝试下一个下载源'); this.name = 'SlowUpdateDownloadError'; }
}

export const UPDATE_DOWNLOAD_POLICY = {
  graceMs: 10_000, windowMs: 30_000, sampleMs: 1_000,
  minimumBytesPerSecond: 32 * 1024, minimumRemainingBytes: 1024 * 1024,
};

interface DownloadOptions {
  // Client ASAR artifacts need raw writes; other downloads keep their existing filesystem.
  fileSystem?: Pick<typeof fs, 'createWriteStream'>;
  expectedHash?: string;
  onProgress?: (received: number) => void;
  slowFallback: boolean;
  allowHttpLoopback?: boolean;
  // Short observation windows for isolated tests; production uses the fixed policy.
  policy?: typeof UPDATE_DOWNLOAD_POLICY;
}

export async function downloadUpdateFile(url: string, destination: string, expectedSize: number, options: DownloadOptions): Promise<void> {
  const policy = options.policy || UPDATE_DOWNLOAD_POLICY;
  const controller = new AbortController();
  let received = 0;
  let sampleBytes = 0;
  const started = Date.now();
  let sampleAt = started;
  let observing = policy.graceMs === 0;
  let slow = false;
  const timer = options.slowFallback ? setInterval(() => {
    const now = Date.now();
    if (!observing) {
      if (now - started < policy.graceMs) return;
      observing = true; sampleAt = now; sampleBytes = received; return;
    }
    if (now - sampleAt < policy.windowMs) return;
    const rate = (received - sampleBytes) * 1000 / (now - sampleAt);
    const remaining = expectedSize - received;
    // Avoid throwing away a nearly finished transfer, or repeatedly aborting all
    // sources on a slow connection. The final source has slowFallback=false.
    if ((rate === 0 && remaining > 0) || (rate < policy.minimumBytesPerSecond && remaining > policy.minimumRemainingBytes &&
        remaining > rate * 10)) {
      slow = true;
      controller.abort();
    }
    sampleAt = now;
    sampleBytes = received;
  }, policy.sampleMs) : undefined;
  timer?.unref();

  async function responseFor(target: string, redirects = 0): Promise<http.IncomingMessage> {
    if (redirects > 5) throw new Error('too many redirects');
    if (!target.startsWith('https://') && !(options.allowHttpLoopback && /^http:\/\/127\.0\.0\.1:\d+\//.test(target))) {
      throw new Error('unsafe update URL');
    }
    const response = await getUpdateResponse(target, {
      signal: controller.signal, timeoutMs: 30_000,
      headers: { 'User-Agent': 'Quenching-Updater/1' },
    });
    if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
      const next = new URL(response.headers.location, target).toString();
      response.destroy();
      return responseFor(next, redirects + 1);
    }
    if (response.statusCode !== 200) { response.destroy(); throw new Error(`HTTP ${response.statusCode || 0}`); }
    if (Number(response.headers['content-length'] || 0) > expectedSize) {
      response.destroy(); throw new Error('download exceeds declared size');
    }
    return response;
  }

  try {
    const response = await responseFor(url);
    const digest = options.expectedHash ? crypto.createHash('sha256') : undefined;
    let reportedAt = 0;
    const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > expectedSize) return callback(new Error('download exceeds declared size'));
      digest?.update(chunk);
      const now = Date.now();
      if (received === expectedSize || now - reportedAt >= 200) {
        reportedAt = now; options.onProgress?.(received);
      }
      callback(null, chunk);
    } });
    await pipeline(response, limiter, (options.fileSystem || fs).createWriteStream(destination, { flags: 'wx' }), { signal: controller.signal });
    if (received !== expectedSize || (options.expectedHash && digest?.digest('hex') !== options.expectedHash.toLowerCase())) {
      throw new Error('download checksum mismatch');
    }
  } catch (error) {
    if (slow) throw new SlowUpdateDownloadError();
    throw error;
  } finally {
    if (timer) clearInterval(timer);
  }
}
