import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

type Address = { address: string; family: number };
type Options = { signal?: AbortSignal; timeoutMs?: number; headers?: Record<string, string> };
/** Dependency overrides are used by isolated TLS fixtures, never update JSON. */
export type UpdateNetworkDependencies = {
  lookup?: (hostname: string) => Promise<Address[]>;
  httpsGet?: typeof https.get;
  connectTimeoutMs?: number;
};
const preferred = new Map<string, Address & { until: number }>();
const CONNECT_TIMEOUT_MS = 5_000;
const TRANSIENT = new Set(['EUPDATECONNECT', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED', 'EAI_AGAIN']);

function aborted(): Error { return Object.assign(new Error('update request aborted'), { name: 'AbortError' }); }
async function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw aborted();
  let abort: () => void;
  const cancellation = new Promise<never>((_resolve, reject) => { abort = () => reject(aborted()); signal.addEventListener('abort', abort, { once: true }); });
  try { return await Promise.race([promise, cancellation]); }
  finally { signal.removeEventListener('abort', abort); }
}
function normalized(address: string | undefined): string | undefined { return address?.replace(/^::ffff:/, ''); }

/** Retry a failed TLS handshake against the other current DNS addresses.
 * Node's TCP Happy Eyeballs can select an edge that accepts TCP but never
 * completes TLS. Keep the original URL, Host and SNI and verify certificates.
 */
export async function getUpdateResponse(target: string | URL, options: Options = {}, dependencies: UpdateNetworkDependencies = {}): Promise<http.IncomingMessage> {
  const url = new URL(target);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsafe update transport URL');
  if (url.hostname === 'qmapi-cn1.txzy.net') throw new Error('Matching server cannot be used for updates');
  const key = url.host;
  const tried = new Set<string>();
  const attempt = (address?: Address): Promise<http.IncomingMessage> => new Promise((resolve, reject) => {
    let finished = false;
    let selected = address?.address;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: any, response?: http.IncomingMessage) => {
      if (finished) { response?.destroy(); return; }
      finished = true;
      if (timer) clearTimeout(timer);
      if (error) { if (selected) tried.add(normalized(selected)); reject(error); }
      else {
        const actual = normalized(response.socket?.remoteAddress);
        if (url.protocol === 'https:' && actual && response.statusCode === 200) {
          preferred.set(key, { address: actual, family: isIP(actual), until: Date.now() + 60_000 });
        }
        resolve(response);
      }
    };
    try {
      if (options.signal?.aborted) { finish(aborted()); return; }
      const lookup = address ? ((_hostname: string, settings: any, callback: any) => {
        if (settings?.all) callback(null, [address]); else callback(null, address.address, address.family);
      }) : undefined;
      const request = (url.protocol === 'https:' ? (dependencies.httpsGet || https.get) : http.get)(url, {
        signal: options.signal, headers: options.headers,
        // A reused agent socket must not bypass the selected fallback address.
        ...(address ? { lookup, autoSelectFamily: false, agent: false } : {}),
      }, response => finish(undefined, response));
      request.on('error', error => finish(error));
      if (options.timeoutMs) request.setTimeout?.(options.timeoutMs, () => request.destroy(Object.assign(new Error('download timed out'), { code: 'ETIMEDOUT' })));
      if (url.protocol === 'https:') {
        timer = setTimeout(() => request.destroy(Object.assign(new Error('update TLS connection timed out'), { code: 'EUPDATECONNECT' })), dependencies.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);
        timer.unref?.();
        request.once('socket', socket => {
          socket.once('connect', () => { selected = socket.remoteAddress || selected; });
          const secure = socket as import('node:tls').TLSSocket;
          if (secure.authorized) { if (timer) clearTimeout(timer); }
          else secure.once('secureConnect', () => { if (timer) clearTimeout(timer); });
        });
      }
    } catch (error) { finish(error); }
  });
  const saved = preferred.get(key);
  const first = saved && saved.until > Date.now() ? saved : undefined;
  try { return await attempt(first); }
  catch (error: any) {
    if (url.protocol !== 'https:' || options.signal?.aborted || !TRANSIENT.has(error?.code)) throw error;
    if (first) { tried.add(first.address); preferred.delete(key); }
    const addresses = await withAbort((dependencies.lookup || (hostname => dns.lookup(hostname, { all: true })))(url.hostname), options.signal);
    let last = error;
    for (const address of addresses.slice(0, 4)) {
      if (tried.has(normalized(address.address))) continue;
      try { return await attempt(address); }
      catch (next: any) {
        last = next;
        if (options.signal?.aborted || !TRANSIENT.has(next?.code)) throw next;
      }
    }
    throw last;
  }
}
