import path from 'node:path';

const pending = new Map<string, Promise<void>>();

/** Serialize mutations of one active directory, including callers from different IPCs. */
export async function withResourceDirectory<T>(directory: string, action: () => Promise<T>): Promise<T> {
  const absolute = path.resolve(directory);
  const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  const previous = pending.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  pending.set(key, current);
  await previous;
  try { return await action(); }
  finally {
    release();
    if (pending.get(key) === current) pending.delete(key);
  }
}
