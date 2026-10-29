import fs from 'fs-extra';
import path from 'node:path';
import yauzl from 'yauzl';
import { resourcePath } from '../../shared/bundled-resource-paths.mjs';
import { resourcePackageNames } from './bundled-packages';
import { readResourceManifest, hasResourceContext } from './bundled-assets';

// These are paths the basic client installs or rewrites independently of the full MOD ZIP.
const BASIC_FILES = [
  'PostProcessingConfig.txt', 'units/unitskin.txt', 'units/unitskin-dis.txt', 'units/destructableskin.txt',
  'terrainart/terrain.slk', 'terrainart/clifftypes.slk', 'terrainart/water.slk',
  'terrainart/terrain-que/terrain.slk', 'terrainart/meta.que',
  'textures/shoreline1.dds', 'textures/shorelineparticlexy.dds', 'textures/fx/flare/heroglow_bw.dds',
  'webui/index.html', 'webui/QuenchingOn.png',
  ...['mainmenu', 'mainmenu_1', 'mainmenu_fk', 'mainmenu_sd', 'mainmenu_tft', 'mainmenu_tft_sd']
    .map(name => `webui/Webms/${name}.webm`),
];

function safeKey(value: string): string | null {
  const key = value.replace(/\\/g, '/');
  return key && !key.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':')) ? key : null;
}

async function listFiles(root: string): Promise<string[]> {
  const stat = await fs.lstat(root).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) return [];
  const files: string[] = [];
  for (const item of await fs.readdir(root, { withFileTypes: true })) {
    if (item.isFile()) files.push(item.name);
    else if (item.isDirectory()) files.push(...(await listFiles(path.join(root, item.name))).map(file => `${item.name}/${file}`));
  }
  return files;
}

const zipCache = new Map<string, { stamp: string; names: string[] }>();
async function zipFiles(file: string): Promise<string[]> {
  const expanded = await resourcePackageNames(file);
  if (expanded) return expanded;
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return [];
  const stamp = `${stat.size}:${stat.mtimeMs}`;
  const cached = zipCache.get(file);
  if (cached?.stamp === stamp) return cached.names;
  const names = await new Promise<string[]>((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error || new Error(`Cannot read client archive: ${file}`));
      const entries: string[] = [];
      zip.on('error', reject);
      zip.on('entry', entry => {
        if (!entry.fileName.endsWith('/')) {
          const key = safeKey(entry.fileName);
          if (key) entries.push(key);
        }
        zip.readEntry();
      });
      zip.on('end', () => resolve(entries));
      zip.readEntry();
    });
  });
  zipCache.set(file, { stamp, names });
  return names;
}

async function defaultAssets(): Promise<string | undefined> {
  const { AssetSyncService } = await import('./asset-sync');
  return path.join(await AssetSyncService.getAssetsDir(), 'quenching');
}

/** File-level ownership from all bundled variants, plus namespaces owned exclusively by the client. */
export async function enumerateClientModFiles(buildDir: string, parked = false, quenchingDir?: string): Promise<string[]> {
  const base = parked ? path.join(buildDir, 'QMoff') : buildDir;
  const files = new Map(BASIC_FILES.map(file => [file.toLowerCase(), file]));
  const add = (file: string) => { const key = safeKey(file); if (key) files.set(key.toLowerCase(), key); };
  const assets = quenchingDir || await defaultAssets();
  if (assets) {
    // A partially expanded cache is not a complete ownership inventory.
    const manifest = hasResourceContext(assets) || !await fs.pathExists(path.join(path.dirname(assets), 'unpacked'))
      ? await readResourceManifest(path.dirname(assets)) : null;
    const addTree = async (source: string, target: string) => {
      const root = resourcePath(assets, source);
      if (manifest) {
        const prefix = source.replace(/\/$/, '') + '/';
        for (const file of Object.keys(manifest?.files || {})) if (file.startsWith(prefix)) add(`${target}/${file.slice(prefix.length)}`);
      } else for (const file of await listFiles(root)) add(`${target}/${file}`);
    };
    for (const pack of ['dnc20', 'dnc30-hd', 'dnc30-de', 'dnc30-de-rpg']) await addTree(`dnc/${pack}`, 'environment/dnc');
    for (const pack of ['shaders203', 'shaders-300-de', 'shaders-ptr-de', 'shaders-300-legacy-de'])
      await addTree(`shaders/${pack}`, 'shaders');
    for (const pack of ['shaders-300-hd', 'shaders-ptr-hd', 'shaders-300-legacy-hd']) {
      await addTree(`shaders/${pack}/vs`, 'shaders/vs');
      for (const mode of ['standard', 'melee', 'rpg']) await addTree(`shaders/${pack}/ps/${mode}`, 'shaders/ps');
    }
    for (const mode of ['water-trans', 'water-rel']) await addTree(`water/${mode}`, 'replaceabletextures/water');
    await addTree('scripts', 'scripts');
    for (const [archive, target] of [
      ['env-20-30-public.zip', 'environment'], ['zip-foliage-que.zip', 'environment'], ['zip-foliage-other.zip', 'environment'],
      ['zip-blight-que.zip', 'terrainart'], ['zip-blight-retro.zip', 'terrainart'], ['lordaerontree.zip', 'doodads'],
    ]) for (const file of await zipFiles(path.join(assets, archive))) add(`${target}/${file}`);
    for (const archive of ['zip-ui-pub.zip', 'zip-ui-20.zip', 'zip-ui-30.zip']) {
      for (const file of await zipFiles(path.join(assets, archive))) {
        add(`ui/${file}`);
        // UIService copies each selected ui-org/que/blz component to the UI root.
        add(`ui/${file.replace(/^ui-(org|que|blz)\//i, '')}`);
      }
    }
  }
  // These entire directories are replaced by their corresponding services.
  for (const [directory, marker] of [['ui', '.quenching-ui-style'], ['shaders', '.quenching-shader-pack']]) {
    if (await fs.pathExists(path.join(base, directory, marker)))
      for (const file of await listFiles(path.join(base, directory))) add(`${directory}/${file}`);
  }
  for (const file of await listFiles(path.join(base, 'cos', 'custom'))) {
    if (/^(sd|hd|de)\/(units|buildings|heroes)\/[^/]+\/[^/]+\//i.test(file)) add(`cos/custom/${file}`);
  }
  for (const directory of ['CommandButtons', 'CommandButtonsDisabled']) {
    for (const file of await listFiles(path.join(base, 'ReplaceableTextures', directory))) {
      if (/^(DIS)?BTNQCustom_[a-f0-9]{24}\.(blp|dds|tga)$/i.test(file)) add(`ReplaceableTextures/${directory}/${file}`);
    }
  }
  const uncensored = await fs.readFile(path.join(buildDir, 'quenching-vio.que'), 'utf8').catch(() => '');
  for (const file of uncensored.split(/\r?\n/)) {
    if (/^(units|buildings|doodads)[\\/]/i.test(file.trim())) add(file.trim());
  }
  const present: string[] = [];
  // Walk existing folders once instead of probing thousands of absent variant paths.
  const roots = new Map<string, string>();
  for (const file of files.values()) {
    const top = file.split('/')[0];
    if (file.includes('/')) roots.set(top.toLowerCase(), top);
    else {
      const stat = await fs.lstat(path.join(base, file)).catch(() => null);
      if (stat?.isFile() && !stat.isSymbolicLink()) present.push(file);
    }
  }
  for (const top of roots.values()) {
    for (const file of await listFiles(path.join(base, top))) {
      const relative = `${top}/${file}`;
      if (files.has(relative.toLowerCase())) present.push(relative);
    }
  }
  return present;
}
