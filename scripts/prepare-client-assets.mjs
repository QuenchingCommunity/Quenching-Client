import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareReleaseAssets } from './prepare-release-assets.mjs';
import { prepareResourceBundle } from './prepare-resource-bundle.mjs';

export async function prepareClientAssets(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  const task = path.join(root, '_tmp/resource-bundle-20261028');
  await fs.mkdir(task, { recursive: true });
  const lock = path.join(task, 'prepare.lock');
  let handle, announced = false;
  while (!handle) {
    try { handle = await fs.open(lock, 'wx'); await handle.writeFile(JSON.stringify({ pid: process.pid })); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await fs.readFile(lock, 'utf8').then(JSON.parse).catch(() => null);
      const lockStat = await fs.stat(lock).catch(() => null);
      if (!owner?.pid && lockStat && Date.now() - lockStat.mtimeMs > 30000) {
        await fs.unlink(lock).catch(e => { if (e.code !== 'ENOENT') throw e; }); continue;
      }
      let alive = true;
      if (owner?.pid) { try { process.kill(owner.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; } }
      if (!alive) { await fs.unlink(lock).catch(e => { if (e.code !== 'ENOENT') throw e; }); continue; }
      if (!announced) { console.log('[Resources] Waiting for the other resource preparation process'); announced = true; }
      await delay(250);
    }
  }
  try {
    await fs.access(path.join(root, 'assets/quenching/1.ico'));
    const logo = path.join(root, 'assets/quenching/logo.png');
    if (!await fs.stat(logo).catch(() => null) && await fs.stat(path.join(root, 'public/logo.png')).catch(() => null)) {
      await fs.copyFile(path.join(root, 'public/logo.png'), logo);
    }
    const release = await prepareReleaseAssets({ root });
    const bundle = await prepareResourceBundle(root);
    console.log(JSON.stringify({ phase: 'prepare-client-assets', label: release.label, ...bundle }));
    return bundle;
  } finally { await handle.close(); await fs.unlink(lock).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareClientAssets();
