import { getUpdateResponse } from './update-network';

export const UPDATE_METADATA_TIMEOUT_MS = 15_000;

/** Direct Node transport: never inherits Electron's system proxy. The deadline
 * covers DNS, TLS, redirects and the complete body, not just socket inactivity. */
export async function requestUpdateMetadata(url: string, options: {
  limit: number;
  allowHttpLoopback?: boolean;
  timeoutMs?: number;
}): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? UPDATE_METADATA_TIMEOUT_MS);
  const visit = async (target: string, redirects: number): Promise<Buffer> => {
    const parsed = new URL(target);
    if ((parsed.protocol !== 'https:' && !(options.allowHttpLoopback && parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1')) ||
        parsed.username || parsed.password || parsed.hash) throw new Error('unsafe update metadata URL');
    if (redirects > 5) throw new Error('too many metadata redirects');
    if (controller.signal.aborted) throw new Error('update metadata request timed out');
    const res = await getUpdateResponse(parsed, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Quenching-Updater/1', Accept: 'application/json, text/plain', 'Cache-Control': 'no-cache' },
      });
    return new Promise<Buffer>((resolve, reject) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
          const next = new URL(res.headers.location, parsed).toString();
          res.destroy();
          visit(next, redirects + 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) { res.destroy(); reject(new Error(`HTTP ${res.statusCode || 0}`)); return; }
        if (Number(res.headers['content-length'] || 0) > options.limit) {
          res.destroy(); reject(new Error('metadata exceeds size limit')); return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > options.limit) {
            reject(new Error('metadata exceeds size limit'));
            res.destroy();
          } else chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
        res.on('aborted', () => reject(new Error('metadata response interrupted')));
    });
  };
  try { return await visit(url, 0); }
  catch (error) {
    if (controller.signal.aborted) throw new Error('update metadata request timed out');
    throw error;
  } finally { clearTimeout(timer); }
}

/** Retry transient transport failures once, after trying the other configured
 * endpoints. Never retry a 404, invalid JSON, bad signature or a closed gate. */
export async function fetchUpdateMetadata<T>(urls: readonly string[], read: (url: string, timeoutMs: number) => Promise<T>): Promise<T> {
  const errors: string[] = [];
  const retry: string[] = [];
  const deadline = Date.now() + 45_000;
  for (const candidates of [[...new Set(urls)], retry]) {
    for (const url of candidates) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`metadata failover deadline exceeded; ${errors.join('; ')}`);
      try { return await read(url, Math.min(UPDATE_METADATA_TIMEOUT_MS, remaining)); }
      catch (error: any) {
        const reason = error?.message || String(error);
        errors.push(`${url}: ${reason}`);
        if (candidates !== retry && /timed out|interrupted|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|HTTP 5\d\d/i.test(reason)) retry.push(url);
      }
    }
  }
  throw new Error(errors.join('; '));
}
