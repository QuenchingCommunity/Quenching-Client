import fs from 'fs-extra';
import path from 'path';
import zlib from 'zlib';
import { randomUUID } from 'node:crypto';
import { enumerateClientModFiles } from './client-mod-files';
import { disableBranchThirdPartyModules } from './branch-third-party-disable';

// Only loose Quenching override roots. Never touch x86_64, CASC data, or game metadata.
export const BRANCH_MOD_FOLDERS = [
  't00', 't16', 't18', 't20', 't30', 'd00', 'd16', 'd18', 'd20', 'd30',
  'RUnits', 'Rbuildings', 'RetroTex', 'cos', 'buildings',
  'campaign', 'doodads', 'env', 'environment', 'fonts', 'patch',
  'replaceabletextures', 'scripts', 'shaders', 'splats', 'terrainart',
  'textures', 'ui', 'units', 'water', 'webui',
] as const;

const STATE_RELATIVE = path.join('.quenching', 'branch-toggle.json');

type Phase = 'disabling' | 'disabled' | 'enabling' | 'enabled';
interface Move { active: string; parked: string }
interface State { schema: 1; phase: Phase; moves: Move[]; previousMoves?: Move[]; pendingMoves?: Move[] }
interface ToggleOptions { quenchingDir?: string }
interface RecoveryOptions extends ToggleOptions {
  /** Uninstall removes all copies itself; only interrupted moves need recovery. */
  reconcileDisabled?: boolean;
}

function allowedPath(relative: string): boolean {
  return relative.toLowerCase() === 'postprocessingconfig.txt' ||
    BRANCH_MOD_FOLDERS.some(folder => folder.toLowerCase() === relative.split('/')[0].toLowerCase());
}

function statePath(buildDir: string): string { return path.join(buildDir, STATE_RELATIVE); }
function absolute(buildDir: string, relative: string): string { return path.join(buildDir, ...relative.split('/')); }
async function existsNoFollow(file: string): Promise<boolean> {
  return !!(await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  }));
}
async function assertSafeParents(buildDir: string, relative: string): Promise<void> {
  let current = buildDir;
  for (const part of relative.split('/').slice(0, -1)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error(`Unsafe MOD directory: ${current}`);
  }
}
function safeRelative(value: string): boolean {
  return !!value && !path.isAbsolute(value) && !value.includes('\\') &&
    !value.split('/').some((part) => !part || part === '.' || part === '..');
}

async function readBundledManifest(version: string): Promise<any | null> {
  const fileName = `qmf-${version}.files.json.gz`;
  const resourcesPath = (process as any).resourcesPath as string | undefined;
  const candidates = Array.from(new Set([
    process.env.QUENCHING_BASELINE_MANIFEST?.trim() || '',
    resourcesPath ? path.join(resourcesPath, 'assets', 'quenching', 'update-baselines', fileName) : '',
    path.join(process.cwd(), 'assets', 'quenching', 'update-baselines', fileName),
  ].filter(Boolean)));
  for (const candidate of candidates) {
    try {
      return JSON.parse(zlib.gunzipSync(await fs.readFile(candidate)).toString('utf8'));
    } catch {
      // Try the next trusted client-bundled location.
    }
  }
  return null;
}

function validateState(value: any): State {
  if (value?.schema !== 1 || !['disabling', 'disabled', 'enabling', 'enabled'].includes(value.phase) || !Array.isArray(value.moves)) {
    throw new Error('Invalid branch toggle record; no files were moved');
  }
  const seen = new Set<string>();
  const validateMoves = (moves: Move[]) => { for (const move of moves) {
    if (!safeRelative(move?.active) || !safeRelative(move?.parked) ||
        !allowedPath(move.active) ||
        !move.parked.startsWith('QMoff/') || seen.has(move.active.toLowerCase())) {
      throw new Error('Unsafe branch toggle record; no files were moved');
    }
    seen.add(move.active.toLowerCase());
  } };
  validateMoves(value.moves);
  for (const key of ['previousMoves', 'pendingMoves']) if (value[key] !== undefined) {
    if (!Array.isArray(value[key]) || value.phase !== 'disabling') throw new Error('Invalid branch toggle extension');
    seen.clear(); validateMoves(value[key]);
  }
  return value as State;
}

async function readState(buildDir: string): Promise<State | null> {
  const file = statePath(buildDir);
  if (!(await fs.pathExists(file))) return null;
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid branch toggle record');
  return validateState(await fs.readJson(file));
}

async function writeState(buildDir: string, state: State): Promise<void> {
  validateState(state);
  const file = statePath(buildDir);
  await fs.ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state), { flag: 'wx' });
  try { await fs.rename(temporary, file); }
  finally { await fs.remove(temporary).catch(() => undefined); }
}

async function readOptionalPackageManifest(buildDir: string): Promise<any | null> {
  // A bundled file list is only a hint for which Quenching files can be
  // parked. Missing/old metadata must never prevent the user from toggling
  // the MOD switch.
  const keep = await fs.readFile(path.join(buildDir, '_patch', 'keep.que'), 'utf8').catch(() => '');
  const versions = [...keep.matchAll(/^-v(\d+(?:\.\d+){1,2})-\s*$/gim)];
  const version = versions.at(-1)?.[1] || '3.4';
  const manifestFile = path.join(buildDir, '_patch', `qmf-${version}.files.json.gz`);
  return fs.readFile(manifestFile)
    .then((compressed) => JSON.parse(zlib.gunzipSync(compressed).toString('utf8')))
    .catch(() => readBundledManifest(version));
}

async function enumeratePackageFiles(buildDir: string, parked: boolean): Promise<string[]> {
  const manifest = await readOptionalPackageManifest(buildDir);
  if (!Array.isArray(manifest?.files)) return [];
  const files: string[] = [];
  const seen = new Set<string>();
  for (const record of manifest.files) {
    const relative = record?.path;
    if (typeof relative !== 'string' || !safeRelative(relative)) continue;
    if (!allowedPath(relative)) continue;
    const key = relative.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const full = absolute(buildDir, parked ? `QMoff/${relative}` : relative);
    if (!(await existsNoFollow(full))) continue; // SD resources may already be in QMoff.
    const stat = await fs.lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    files.push(relative);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function planDisable(buildDir: string, options: ToggleOptions): Promise<Move[]> {
  const moves: Move[] = [];
  const files = new Map<string, string>();
  for (const file of [...await enumeratePackageFiles(buildDir, false),
    ...await enumerateClientModFiles(buildDir, false, options.quenchingDir)]) {
    if (allowedPath(file)) files.set(file.toLowerCase(), file);
  }
  for (const active of files.values()) {
    const parked = `QMoff/${active}`;
    await assertSafeParents(buildDir, parked);
    moves.push({ active, parked });
  }
  return moves;
}

async function planLegacyEnable(buildDir: string, options: ToggleOptions): Promise<Move[]> {
  const files = new Map<string, string>();
  for (const file of [...await enumeratePackageFiles(buildDir, true),
    ...await enumerateClientModFiles(buildDir, true, options.quenchingDir)]) {
    if (allowedPath(file)) files.set(file.toLowerCase(), file);
  }
  const moves: Move[] = [];
  for (const active of files.values()) {
    if (!(await existsNoFollow(absolute(buildDir, active)))) moves.push({ active, parked: `QMoff/${active}` });
  }
  return moves;
}

async function moveOne(from: string, to: string): Promise<boolean> {
  if (!(await existsNoFollow(from))) return false;
  const stat = await fs.lstat(from);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Cannot move unexpected MOD path: ${from}`);
  await fs.ensureDir(path.dirname(to));
  if (await existsNoFollow(to)) await fs.remove(to);
  await fs.rename(from, to);
  return true;
}

/** Reverse only moves that actually happened. */
async function rollBack(buildDir: string, state: State, moves: Move[] = state.moves): Promise<void> {
  const disabling = state.phase === 'disabling';
  for (const move of [...moves].reverse()) {
    const original = absolute(buildDir, disabling ? move.active : move.parked);
    const moved = absolute(buildDir, disabling ? move.parked : move.active);
    await assertSafeParents(buildDir, disabling ? move.active : move.parked);
    await assertSafeParents(buildDir, disabling ? move.parked : move.active);
    const [hasOriginal, hasMoved] = await Promise.all([existsNoFollow(original), existsNoFollow(moved)]);
    if (hasOriginal && !hasMoved) continue;
    if (!hasMoved) continue; // A client-managed profile can legitimately remove optional files.
    await moveOne(moved, original);
  }
}

/** Called before synchronization/IPC. Recover only this new, exact file-level transaction. */
export async function recoverBranchModToggle(buildDir: string, options: RecoveryOptions = {}): Promise<boolean | null> {
  const state = await readState(buildDir);
  if (!state) return null;
  if (state.phase === 'disabling' || state.phase === 'enabling') {
    await rollBack(buildDir, state, state.pendingMoves || state.moves);
    if (state.phase === 'disabling' && state.previousMoves) {
      await writeState(buildDir, { schema: 1, phase: 'disabled', moves: state.previousMoves });
      return false;
    }
    if (state.phase === 'disabling') await fs.unlink(statePath(buildDir));
    else await writeState(buildDir, { ...state, phase: 'disabled' });
    return state.phase === 'disabling';
  }
  if (state.phase === 'enabled') {
    await fs.unlink(statePath(buildDir));
    return true;
  }
  // Older clients left basic UI/lighting files active even with a disabled journal.
  if (options.reconcileDisabled !== false) await setBranchModEnabledOnDisk(buildDir, false, options);
  return false;
}

/** Recover interrupted moves first, then make an off preference true on disk. */
export async function recoverBranchModToggleAtStartup(buildDir: string, configuredEnabled: boolean, options: ToggleOptions = {}): Promise<boolean | null> {
  const restoredEnabled = await recoverBranchModToggle(buildDir, { ...options, reconcileDisabled: false });
  const enabled = configuredEnabled && restoredEnabled !== false;
  if (!enabled) {
    await setBranchModEnabledOnDisk(buildDir, false, options);
  }
  return restoredEnabled === null ? null : enabled;
}

async function hasActiveVisionModules(buildDir: string): Promise<boolean> {
  const vision = await fs.readJson(path.join(buildDir, '.quenching-vision-modules.json')).catch(error => {
    if (error.code === 'ENOENT') return {};
    throw error;
  });
  return Object.keys(vision).length > 0;
}

export async function isBranchModDisabled(buildDir: string): Promise<boolean> {
  const state = await readState(buildDir);
  if (state && state.phase !== 'disabled') throw new Error('Branch toggle is incomplete; recover it before continuing');
  return state?.phase === 'disabled';
}

/** After uninstall removes all owned copies, retain the off state without
 * probing the removed package or keeping moves that could restore old files. */
export async function markBranchModUninstalled(buildDir: string): Promise<void> {
  const state = await readState(buildDir);
  if (state && state.phase !== 'disabled') throw new Error('Branch toggle is incomplete');
  await writeState(buildDir, { schema: 1, phase: 'disabled', moves: [] });
}

/** Resolve an owned file in its parked location while the branch switch is off. */
export async function resolveBranchModFile(buildDir: string, relative: string): Promise<string> {
  if (!safeRelative(relative)) throw new Error('Invalid branch resource path');
  const state = await readState(buildDir);
  if (state && state.phase !== 'disabled') throw new Error('Branch toggle is incomplete');
  const move = state?.moves.find(item => item.active.toLowerCase() === relative.toLowerCase());
  const target = move?.parked || relative;
  await assertSafeParents(buildDir, target);
  return absolute(buildDir, target);
}

/** Register a new preference file in the off journal before writing its parked copy. */
export async function prepareBranchModFileWrite(buildDir: string, relative: string): Promise<string> {
  if (!safeRelative(relative) || !allowedPath(relative)) throw new Error('Invalid MOD write path');
  const state = await readState(buildDir);
  if (!state) return absolute(buildDir, relative);
  if (state.phase !== 'disabled') throw new Error('Branch toggle is incomplete');
  const recorded = state.moves.find(move => move.active.toLowerCase() === relative.toLowerCase());
  if (recorded) return resolveBranchModFile(buildDir, relative);
  const move = { active: relative, parked: `QMoff/branch-created/${relative}` };
  await assertSafeParents(buildDir, move.parked);
  await writeState(buildDir, { ...state, moves: [...state.moves, move] });
  return absolute(buildDir, move.parked);
}

/** Toggle what is available and remember exact moves when resources exist.
 * Basic client resources are included even when no full package is installed. */
export async function applyBranchModFilesForSwitch(buildDir: string, enabled: boolean, options: ToggleOptions = {}): Promise<void> {
  await setBranchModEnabledOnDisk(buildDir, enabled, options);
}

export async function setBranchModEnabledOnDisk(buildDir: string, enabled: boolean, options: ToggleOptions = {}): Promise<void> {
  let existing = await readState(buildDir);
  if (existing && existing.phase !== 'disabled') throw new Error('Branch toggle is incomplete');
  if (enabled && await hasActiveVisionModules(buildDir)) throw new Error('请先关闭 Vision Mod 模块，再切换 MOD 总开关');
  if (!enabled) await disableBranchThirdPartyModules(buildDir);
  if (enabled && !existing) {
    // 3.4 could park a complete package in QMoff without leaving a journal.
    // Restore any client-known files once, then continue with the new journal.
    const moves = await planLegacyEnable(buildDir, options);
    if (!moves.length) return;
    existing = { schema: 1, phase: 'disabled', moves };
  }
  // Custom icons imported while off live in QMoff until the branch is enabled.
  if (enabled && existing) {
    const icons = (await enumerateClientModFiles(buildDir, true, options.quenchingDir))
      .filter(file => /\/((DIS)?BTNQCustom_[a-f0-9]{24})\.(blp|dds|tga)$/i.test(file));
    const known = new Set(existing.moves.map(move => move.active.toLowerCase()));
    existing = { ...existing, moves: [...existing.moves, ...icons.filter(file => !known.has(file.toLowerCase()))
      .map(active => ({ active, parked: `QMoff/${active}` }))] };
  }
  const pending = enabled ? [] : await planDisable(buildDir, options);
  if (!enabled && existing && !pending.length) return;
  if (!enabled && existing) {
    // Keep the previous parked copy intact so an interrupted repair can be rolled back.
    const token = randomUUID();
    for (const move of pending) move.parked = `QMoff/branch-residuals/${token}/${move.active}`;
  }
  const merged = new Map((existing?.moves || []).map(move => [move.active.toLowerCase(), move]));
  for (const move of pending) merged.set(move.active.toLowerCase(), move);
  const state: State = enabled
    ? { ...existing!, phase: 'enabling' }
    : { schema: 1, phase: 'disabling', moves: [...merged.values()],
      ...(existing ? { previousMoves: existing.moves, pendingMoves: pending } : {}) };
  const availableMoves: Move[] = [];
  for (const move of enabled ? state.moves : pending) {
    const from = absolute(buildDir, enabled ? move.parked : move.active);
    const to = absolute(buildDir, enabled ? move.active : move.parked);
    await assertSafeParents(buildDir, enabled ? move.parked : move.active);
    await assertSafeParents(buildDir, enabled ? move.active : move.parked);
    if (await existsNoFollow(from)) availableMoves.push(move);
  }
  if (enabled) state.moves = availableMoves;
  await writeState(buildDir, state);
  const completed: Move[] = [];
  try {
    for (const move of availableMoves) {
      const from = absolute(buildDir, enabled ? move.parked : move.active);
      const to = absolute(buildDir, enabled ? move.active : move.parked);
      if (await moveOne(from, to)) completed.push(move);
    }
    if (enabled) {
      await writeState(buildDir, { ...state, phase: 'enabled' });
      await fs.unlink(statePath(buildDir));
    } else {
      await writeState(buildDir, { schema: 1, phase: 'disabled', moves: state.moves });
    }
  } catch (error) {
    try {
      await rollBack(buildDir, state, completed);
      if (enabled) await writeState(buildDir, { ...state, phase: 'disabled' });
      else if (state.previousMoves) await writeState(buildDir, { schema: 1, phase: 'disabled', moves: state.previousMoves });
      else await fs.unlink(statePath(buildDir));
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'MOD toggle failed and needs safe recovery');
    }
    throw error;
  }
}
