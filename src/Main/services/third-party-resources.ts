import { getSelectedGameFolder } from './game-channel';
import fs from 'fs-extra';
import path from 'path';
import crypto from 'node:crypto';
import yauzl from 'yauzl';
import { pipeline } from 'node:stream/promises';
import { isFullPackageInstalled } from './full-package-service';

export interface QuenchingFeatureChoice {
  id: string;
  blocked: boolean;
  selected: boolean;
}

export interface ResourceSlot {
  id: number;
  name: string;
  imported: boolean;
  enabled: boolean;
  fingerprint: string;
  files: string[];
  quenching: Record<string, boolean>;
  parked: Array<{ featureId: string; paths: string[] }>;
  replaced: string[];
  stagingPath?: string;
  topLevel?: string[];
  features?: QuenchingFeatureChoice[];
}

export interface ThirdPartyState {
  slots: ResourceSlot[];
  activeSlotId: number | null;
}

interface QuenchingFeature {
  id: string;
  dirs: string[];
  files: string[];
}

const STATE_FILE = '_QMThirdParty.json';
const MARKER = 'keep.que';
const DEFAULT_DIRS = ['environment', 'shaders', 'buildings', 'campaign', 'doodads', 'fonts', 'patch', 'replaceabletextures', 'splats', 'terrainart', 'textures', 'units', 'ui', 'scripts', 'webui', 'cos', 'RUnits', 'Runits', 'Rbuildings', 't00', 't16', 't18', 't20', 't30', 'd00', 'd16', 'd18', 'd20'];
const GAME_ROOTS = new Set([
  ...DEFAULT_DIRS.map(name => name.toLowerCase()),
  'env',
]);
const FEATURES: QuenchingFeature[] = [
  { id: 'terrain', dirs: ['t00', 't16', 't18', 't20', 't30'], files: ['terrainart/terrain.slk', 'terrainart/clifftypes.slk'] },
  { id: 'water', dirs: [], files: ['terrainart/water.slk'] },
  { id: 'environment', dirs: ['environment'], files: [] },
  { id: 'shaders', dirs: ['shaders'], files: [] },
  { id: 'ui', dirs: ['ui', 'webui'], files: [] },
  { id: 'units', dirs: ['units', 'buildings', 'cos', 'runits', 'rbuildings'], files: [] },
  { id: 'scripts', dirs: ['scripts'], files: [] },
  { id: 'trees', dirs: [], files: ['units/destructableskin.txt'] },
];

function retail(root: string): string { return path.join(root, getSelectedGameFolder()); }
function statePath(root: string): string { return path.join(retail(root), STATE_FILE); }
function stageDir(root: string, id: number): string { return path.join(root, `QM Assets ${id}`); }
function parkRoot(root: string): string { return path.join(retail(root), 'QMoff', 'third-party'); }
function replacedRoot(root: string, id: number): string { return path.join(parkRoot(root), `replaced-${id}`); }
function norm(value: string): string { return value.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '').replace(/\/{2,}/g, '/'); }
function first(value: string): string { return value.split('/')[0]; }
function isBranch(name: string): boolean { return name.toLowerCase() === '_retail_' || name.toLowerCase() === '_ptr_'; }
function isGameRoot(name: string): boolean { return GAME_ROOTS.has(name.toLowerCase()); }
function ignoredName(name: string): boolean { return name === '.DS_Store' || name === 'Thumbs.db' || name === '__MACOSX'; }

/** Drop wrapper folders so the remainder is what would be copied straight into _retail_ or _ptr_. */
export function peelToGamePaths(relativePaths: string[], preferredBranch: '_retail_' | '_ptr_' = '_retail_'): string[] {
  return peelMapped(relativePaths.map(item => ({ from: item, to: item })), preferredBranch).map(item => item.to);
}

function peelMapped<T extends { to: string }>(items: T[], preferredBranch: '_retail_' | '_ptr_'): T[] {
  let current = items
    .map(item => ({ ...item, to: norm(item.to) }))
    .filter(item => item.to && !item.to.endsWith('/') && !item.to.split('/').some(ignoredName));
  for (let pass = 0; pass < 8 && current.length; pass++) {
    const directoryTops = Array.from(new Set(current.filter(item => item.to.includes('/')).map(item => first(item.to))));
    const branches = directoryTops.filter(isBranch);
    if (branches.length) {
      const chosen = branches.find(name => name.toLowerCase() === preferredBranch.toLowerCase()) || branches[0];
      current = current
        .filter(item => first(item.to).toLowerCase() === chosen.toLowerCase())
        .map(item => ({ ...item, to: item.to.split('/').slice(1).join('/') }))
        .filter(item => item.to);
      continue;
    }
    if (directoryTops.length === 1 && !isGameRoot(directoryTops[0])) {
      const wrapper = directoryTops[0];
      const inner = current
        .filter(item => first(item.to).toLowerCase() === wrapper.toLowerCase() && item.to.includes('/'))
        .map(item => ({ ...item, to: item.to.split('/').slice(1).join('/') }))
        .filter(item => item.to);
      if (inner.some(item => isGameRoot(first(item.to)) || isBranch(first(item.to)))) {
        current = inner;
        continue;
      }
    }
    break;
  }
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of [...current].reverse()) {
    if (item.to.split('/').some(part => part === '.' || part === '..' || part.includes(':'))) continue;
    const key = item.to.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique.reverse();
}

function fingerprintOf(files: string[]): string {
  return crypto.createHash('sha1').update(files.map(file => file.toLowerCase()).sort().join('\n')).digest('hex');
}

function topLevelOf(files: string[]): string[] {
  return Array.from(new Set(files.map(file => first(file)))).sort((a, b) => a.localeCompare(b));
}

function featureBlocked(feature: QuenchingFeature, files: string[]): boolean {
  const tops = new Set(files.map(file => first(file).toLowerCase()));
  const owned = new Set(files.map(file => file.toLowerCase()));
  if (feature.dirs.some(dir => tops.has(dir.toLowerCase()))) return true;
  return feature.files.some(file => owned.has(file.toLowerCase()));
}

function choicesFor(slot: ResourceSlot): QuenchingFeatureChoice[] {
  return FEATURES.map(feature => {
    const blocked = slot.imported && featureBlocked(feature, slot.files);
    return { id: feature.id, blocked, selected: blocked ? false : slot.quenching[feature.id] !== false };
  });
}

function present(slot: ResourceSlot): ResourceSlot {
  return {
    ...slot,
    stagingPath: undefined,
    topLevel: topLevelOf(slot.files),
    features: choicesFor(slot),
  };
}

function defaults(): ThirdPartyState {
  return {
    slots: [1, 2, 3, 4, 5].map(id => ({
      id,
      name: `Assets ${id}`,
      imported: false,
      enabled: false,
      fingerprint: '',
      files: [],
      quenching: Object.fromEntries(FEATURES.map(feature => [feature.id, true])),
      parked: [],
      replaced: [],
    })),
    activeSlotId: null,
  };
}

async function readState(root: string): Promise<ThirdPartyState> {
  const saved = await fs.readJson(statePath(root)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!saved) return defaults();
  if (!Array.isArray(saved.slots) || saved.slots.some((item: ResourceSlot) => typeof item?.imported !== 'boolean')) {
    throw new Error(`第三方资源状态文件无效，请检查: ${statePath(root)}`);
  }
  const base = defaults();
  const byId = new Map<number, ResourceSlot>();
  for (const candidate of saved.slots as ResourceSlot[]) {
    if (!Number.isInteger(candidate?.id) || candidate.id < 1 || candidate.id > 5 || byId.has(candidate.id)) continue;
    byId.set(candidate.id, {
      ...base.slots[candidate.id - 1],
      ...candidate,
      name: candidate.name === `QM Assets ${candidate.id}`
        ? base.slots[candidate.id - 1].name
        : typeof candidate.name === 'string' && candidate.name.trim()
          ? candidate.name.trim().slice(0, 60)
          : base.slots[candidate.id - 1].name,
      files: Array.isArray(candidate.files) ? candidate.files.map(norm).filter(Boolean) : [],
      quenching: { ...base.slots[candidate.id - 1].quenching, ...(candidate.quenching || {}) },
      parked: Array.isArray(candidate.parked) ? candidate.parked : [],
      replaced: Array.isArray(candidate.replaced) ? candidate.replaced : [],
    });
  }
  return { activeSlotId: saved.activeSlotId ?? null, slots: base.slots.map(slot => byId.get(slot.id) || slot) };
}

async function writeState(root: string, state: ThirdPartyState): Promise<void> {
  const stored = {
    activeSlotId: state.activeSlotId,
    slots: state.slots.map(({ stagingPath: _staging, topLevel: _top, features: _features, ...slot }) => slot),
  };
  const temp = `${statePath(root)}.tmp`;
  await fs.ensureDir(path.dirname(temp));
  await fs.writeJson(temp, stored, { spaces: 2 });
  await fs.move(temp, statePath(root), { overwrite: true });
}

async function assertRetail(root: string): Promise<void> {
  if (!root || !(await fs.pathExists(retail(root)))) throw new Error('未找到当前游戏分支目录');
}

function slotOf(state: ThirdPartyState, id: number): ResourceSlot {
  const found = state.slots.find(item => item.id === id);
  if (!found) throw new Error('资源槽不存在');
  return found;
}

function withPaths(state: ThirdPartyState, root: string): ThirdPartyState {
  return {
    ...state,
    slots: state.slots.map(slot => ({ ...present(slot), stagingPath: stageDir(root, slot.id) })),
  };
}

export async function getThirdPartyState(root: string): Promise<ThirdPartyState> {
  await assertRetail(root);
  return withPaths(await readState(root), root);
}

export async function setThirdPartyName(root: string, id: number, name: string): Promise<ThirdPartyState> {
  await assertRetail(root);
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean || clean.length > 40 || /[\x00-\x1f]/.test(clean)) throw new Error('资源槽名称须为 1–40 个字符');
  const state = await readState(root);
  slotOf(state, id).name = clean;
  await writeState(root, state);
  return withPaths(state, root);
}

export async function isThirdPartyQuenchingPaused(root: string): Promise<boolean> {
  if(Object.values(await (await import('./vision-modules')).getVisionModules(root)).some(Boolean))return true;
  if (!(await fs.pathExists(statePath(root)))) return false;
  const state = await readState(root);
  return state.slots.some(slot => slot.enabled);
}

async function moveRelative(fromBase: string, toBase: string, relative: string): Promise<void> {
  const from = path.join(fromBase, relative);
  const to = path.join(toBase, relative);
  if (!(await fs.pathExists(from))) return;
  if (await fs.pathExists(to)) throw new Error(`${relative} 的停放位置已存在`);
  await fs.ensureDir(path.dirname(to));
  await fs.move(from, to, { overwrite: false });
}

async function parkFeature(root: string, feature: QuenchingFeature): Promise<string[]> {
  const branch = retail(root);
  const destination = path.join(parkRoot(root), feature.id);
  const moved: string[] = [];
  for (const dir of feature.dirs) {
    if (!(await fs.pathExists(path.join(branch, dir)))) continue;
    await moveRelative(branch, destination, dir);
    moved.push(dir);
  }
  for (const file of feature.files) {
    if (moved.some(dir => file.toLowerCase() === dir.toLowerCase() || file.toLowerCase().startsWith(`${dir.toLowerCase()}/`))) continue;
    if (!(await fs.pathExists(path.join(branch, file)))) continue;
    await moveRelative(branch, destination, file);
    moved.push(file);
  }
  return moved;
}

async function restoreParked(root: string, parked: Array<{ featureId: string; paths: string[] }>): Promise<void> {
  const branch = retail(root);
  for (const item of parked) {
    const source = path.join(parkRoot(root), item.featureId);
    for (const relative of item.paths) await moveRelative(source, branch, relative);
  }
}

async function disableSlot(root: string, state: ThirdPartyState, slot: ResourceSlot): Promise<void> {
  if (!slot.enabled) return;
  const branch = retail(root);
  for (const relative of slot.files) await fs.remove(path.join(branch, relative));
  for (const relative of slot.parked.flatMap(item => item.paths)) await fs.remove(path.join(branch, relative));
  for (const relative of slot.replaced) await moveRelative(replacedRoot(root, slot.id), branch, relative);
  await restoreParked(root, slot.parked);
  await fs.remove(replacedRoot(root, slot.id));
  slot.enabled = false;
  slot.parked = [];
  slot.replaced = [];
  if (state.activeSlotId === slot.id) state.activeSlotId = null;
}

async function enableSlot(root: string, state: ThirdPartyState, slot: ResourceSlot): Promise<void> {
  if (!slot.imported || slot.files.length === 0) throw new Error('请先导入资源');
  if (slot.enabled) return;
  const other = state.slots.find(item => item.enabled && item.id !== slot.id);
  if (other) await disableSlot(root, state, other);
  const choices = choicesFor(slot);
  for (const choice of choices) slot.quenching[choice.id] = choice.selected;
  const branch = retail(root);
  const staging = stageDir(root, slot.id);
  const parked: Array<{ featureId: string; paths: string[] }> = [];
  const replaced: string[] = [];
  const applied: string[] = [];
  try {
    for (const feature of FEATURES) {
      if (slot.quenching[feature.id] !== false) continue;
      const paths = await parkFeature(root, feature);
      if (paths.length) parked.push({ featureId: feature.id, paths });
    }
    for (const relative of slot.files) {
      const destination = path.join(branch, relative);
      if (await fs.pathExists(destination)) {
        const stat = await fs.stat(destination);
        if (stat.isDirectory()) throw new Error(`${relative} 已存在且不是文件，无法覆盖`);
        await moveRelative(branch, replacedRoot(root, slot.id), relative);
        replaced.push(relative);
      }
      await fs.copy(path.join(staging, relative), destination, { overwrite: false, errorOnExist: true });
      applied.push(relative);
    }
  } catch (error) {
    for (const relative of applied.sort((a, b) => b.length - a.length)) await fs.remove(path.join(branch, relative));
    for (const relative of replaced) await moveRelative(replacedRoot(root, slot.id), branch, relative).catch(() => undefined);
    await restoreParked(root, parked);
    throw error;
  }
  slot.enabled = true;
  slot.parked = parked;
  slot.replaced = replaced;
  state.activeSlotId = slot.id;
}

export async function setThirdPartyEnabled(root: string, id: number, enabled: boolean): Promise<ThirdPartyState> {
  await assertRetail(root);
  const state = await readState(root);
  const slot = slotOf(state, id);
  if(enabled && Object.values(await (await import('./vision-modules')).getVisionModules(root)).some(Boolean))throw new Error('请先关闭 Vision Mod 模块，再启用资源槽');
  if (enabled) await enableSlot(root, state, slot);
  else await disableSlot(root, state, slot);
  await writeState(root, state);
  return withPaths(state, root);
}

export async function setThirdPartyFeature(root: string, id: number, featureId: string, enabled: boolean): Promise<ThirdPartyState> {
  const feature = FEATURES.find(item => item.id === featureId);
  if (!feature) throw new Error('未知的淬火功能');
  await assertRetail(root);
  const state = await readState(root);
  const slot = slotOf(state, id);
  if (!slot.imported) throw new Error('请先导入资源');
  if (featureBlocked(feature, slot.files)) throw new Error('该淬火功能与当前资源包冲突，在资源包变化前不能打开');
  slot.quenching[featureId] = enabled;
  if (slot.enabled) {
    if (!enabled) {
      const paths = await parkFeature(root, feature);
      const existing = slot.parked.find(item => item.featureId === featureId);
      if (existing) existing.paths = Array.from(new Set([...existing.paths, ...paths]));
      else if (paths.length) slot.parked.push({ featureId, paths });
    } else {
      const existing = slot.parked.find(item => item.featureId === featureId);
      if (existing) {
        await restoreParked(root, [existing]);
        slot.parked = slot.parked.filter(item => item.featureId !== featureId);
      }
    }
  }
  await writeState(root, state);
  return withPaths(state, root);
}

async function listDirectory(dir: string, base = dir): Promise<Array<{ from: string; to: string }>> {
  const found: Array<{ from: string; to: string }> = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (ignoredName(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await listDirectory(absolute, base));
    else if (entry.isFile()) found.push({ from: absolute, to: path.relative(base, absolute) });
  }
  return found;
}

async function openZip(zipPath: string): Promise<{ zip: yauzl.ZipFile; entries: Array<{ from: string; to: string; entry: yauzl.Entry }> }> {
  if (path.extname(zipPath).toLowerCase() !== '.zip' || !(await fs.pathExists(zipPath))) throw new Error('请选择 ZIP 文件');
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (error, file) => error || !file ? reject(error) : resolve(file)));
  const entries: Array<{ from: string; to: string; entry: yauzl.Entry }> = [];
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('entry', entry => {
        const raw = entry.fileName.replace(/\\/g, '/');
        if (raw.startsWith('/') || /^[a-z]:/i.test(raw) || raw.includes('\0') ||
          raw.split('/').some(part => part === '..' || part.includes(':'))) {
          reject(new Error(`ZIP 中存在不安全路径：${entry.fileName}`));
          return;
        }
        if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) {
          reject(new Error(`ZIP 中不支持符号链接：${entry.fileName}`));
          return;
        }
        const name = norm(entry.fileName);
        if (!name.endsWith('/')) entries.push({ from: name, to: name, entry });
        zip.readEntry();
      });
      zip.once('end', resolve);
      zip.once('error', reject);
      zip.readEntry();
    });
    return { zip, entries };
  } catch (error) {
    zip.close();
    throw error;
  }
}

async function stageFiles<T extends { from: string; to: string }>(root: string, id: number, files: T[], write: (file: T, destination: string) => Promise<void>): Promise<{ directory: string; files: string[] }> {
  const staging = await fs.mkdtemp(path.join(root, `.QM-Assets-${id}-import-`));
  const written: string[] = [];
  try {
    for (const file of files) {
      const destination = path.join(staging, file.to);
      await fs.ensureDir(path.dirname(destination));
      await write(file, destination);
      written.push(file.to);
    }
    return { directory: staging, files: written };
  } catch (error) {
    await fs.remove(staging);
    throw error;
  }
}

export async function importThirdPartySource(root: string, id: number, source: { kind: 'zip'; path: string } | { kind: 'directory'; path: string }): Promise<ThirdPartyState> {
  await assertRetail(root);
  const state = await readState(root);
  const slot = slotOf(state, id);
  const preferred = getSelectedGameFolder();
  let incoming: { directory: string; files: string[] } | null = null;
  try {
    if (source.kind === 'directory') {
      const selected = path.resolve(source.path);
      if (selected === path.resolve(root) || selected === path.resolve(retail(root))) throw new Error('请选择资源包目录，而不是魔兽安装目录');
      if (!(await fs.pathExists(selected)) || !(await fs.stat(selected)).isDirectory()) throw new Error('请选择资源目录');
      const peeled = peelMapped(await listDirectory(selected), preferred);
      if (!peeled.length) throw new Error('没有可放入游戏分支的资源');
      incoming = await stageFiles(root, id, peeled, (file, destination) => fs.copy(file.from, destination, { overwrite: false, errorOnExist: true }));
    } else {
      const opened = await openZip(source.path);
      try {
        const peeled = peelMapped(opened.entries, preferred);
        if (!peeled.length) throw new Error('没有可放入游戏分支的资源');
        incoming = await stageFiles(root, id, peeled, async (file, destination) => {
          const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => opened.zip.openReadStream(file.entry, (error, input) => error || !input ? reject(error) : resolve(input)));
          await pipeline(stream, fs.createWriteStream(destination, { flags: 'wx' }));
        });
      } finally {
        opened.zip.close();
      }
    }

    if (!incoming) throw new Error('资源包暂存失败');
    const files = incoming.files;
    const previousSlot = structuredClone(slot);
    const wasEnabled = slot.enabled;
    const previousStage = await fs.mkdtemp(path.join(root, `.QM-Assets-${id}-previous-`));
    const savedStage = path.join(previousStage, 'stage');
    const activeStage = stageDir(root, id);
    let disabled = false;
    let oldMoved = false;
    let newMoved = false;
    try {
      if (wasEnabled) {
        await disableSlot(root, state, slot);
        disabled = true;
      }
      if (await fs.pathExists(activeStage)) {
        await fs.move(activeStage, savedStage, { overwrite: false });
        oldMoved = true;
      }
      await fs.move(incoming.directory, activeStage, { overwrite: false });
      newMoved = true;
      const nextFingerprint = fingerprintOf(files);
      const changed = nextFingerprint !== slot.fingerprint;
      slot.imported = true;
      slot.files = files;
      slot.fingerprint = nextFingerprint;
      if (changed) {
        for (const feature of FEATURES) slot.quenching[feature.id] = !featureBlocked(feature, files);
      } else {
        for (const feature of FEATURES) if (featureBlocked(feature, files)) slot.quenching[feature.id] = false;
      }
      const result = withPaths(state, root);
      await writeState(root, state);
      return result;
    } catch (error) {
      try {
        if (newMoved) await fs.remove(activeStage);
        if (oldMoved) await fs.move(savedStage, activeStage, { overwrite: false });
        if (disabled) {
          Object.assign(slot, previousSlot, { enabled: false, parked: [], replaced: [] });
          await enableSlot(root, state, slot);
        }
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], '第三方资源导入失败，旧资源恢复也失败');
      }
      throw error;
    } finally {
      await fs.remove(previousStage).catch(() => undefined);
    }
  } finally {
    if (incoming) await fs.remove(incoming.directory).catch(() => undefined);
  }
}

const quenchingOff = (root: string) => path.join(retail(root), 'QMoff');

export async function markKnownQuenching(root: string): Promise<void> {
  if (!(await isFullPackageInstalled(root))) {
    for (const base of [retail(root), quenchingOff(root)]) {
      for (const [name, signature] of [
        ['environment', '.quenching-public-environment'],
        ['shaders', '.quenching-shader-profile'],
        ['shaders', '.quenching-shader-pack'],
      ]) {
        const dir = path.join(base, name);
        if (await fs.pathExists(path.join(dir, signature))) await fs.ensureFile(path.join(dir, MARKER));
      }
    }
    return;
  }
  for (const name of DEFAULT_DIRS) {
    for (const base of [retail(root), quenchingOff(root)]) {
      const dir = path.join(base, name);
      if (await fs.pathExists(dir) && (await fs.stat(dir)).isDirectory()) await fs.ensureFile(path.join(dir, MARKER));
    }
  }
}
