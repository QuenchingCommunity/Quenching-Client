import fs from 'fs-extra';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import rotations from '../../../assets/unpacked/experimental/de-unit-rotations.json';
import { DncLightingOptions, renderDncLighting } from './dnc-lighting';
import { buildRotatingLightTrack } from '../../shared/dnc-rotation';

// Deliberate allowlist: terrain, portraits, underground, dungeon and custom DNC
// models can never become write targets of this experiment.
export const ROTATING_UNIT_FILES = Object.freeze(Object.keys(rotations.sources));

function blockEnd(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; at++) {
    if (text.startsWith('//', at)) {
      const end = text.indexOf('\n', at);
      at = end < 0 ? text.length : end;
    } else if (text.startsWith('/*', at)) {
      const end = text.indexOf('*/', at + 2);
      if (end < 0) throw new Error('Unclosed DNC comment');
      at = end + 1;
    } else if (text[at] === '"') {
      for (at++; at < text.length && text[at] !== '"'; at++) {
        if (text[at] === '\\') at++;
      }
    } else if (text[at] === '{') depth++;
    else if (text[at] === '}' && --depth === 0) return at + 1;
  }
  throw new Error('Unclosed DNC block');
}

function rotationSpan(content: string): { start: number; end: number } {
  const lights = [...content.matchAll(/^Light\s+"[^"\r\n]*"\s*\{/gm)];
  if (lights.length !== 1) throw new Error('Unsupported DNC light layout');
  const lightStart = lights[0].index!;
  const lightEnd = blockEnd(content, content.indexOf('{', lightStart));
  const light = content.slice(lightStart, lightEnd);
  if (Number(light.match(/^\s*ObjectId\s+(\d+)\s*,/m)?.[1]) !== rotations.objectId ||
      /^\s*Parent\s+(?!-1\s*,)/m.test(light)) throw new Error('Unsupported DNC light hierarchy');
  const tracks = [...light.matchAll(/^[\t ]*Rotation\s+\d+\s*\{/gm)];
  if (tracks.length !== 1) throw new Error('Unsupported DNC rotation layout');
  const start = lightStart + tracks[0].index!;
  return { start, end: blockEnd(content, content.indexOf('{', start)) };
}

/** Exported for byte-level isolation checks; no full MDL reserialization. */
export function unitRotationBlock(content: string): string {
  const { start, end } = rotationSpan(content);
  return content.slice(start, end);
}

export function replaceUnitRotation(content: string, block: string): string {
  const { start, end } = rotationSpan(content);
  return content.slice(0, start) + block + content.slice(end);
}

function deRotationBlock(content: string, angle?: number): string {
  const intervals = [...content.matchAll(/\bInterval\s*\{\s*(\d+)\s*,\s*(\d+)\s*\}/g)];
  if (intervals.length !== 1) throw new Error('Unsupported DNC animation interval');
  const start = Number(intervals[0][1]);
  const duration = Number(intervals[0][2]) - start;
  if (duration <= 0) throw new Error('Invalid DNC animation interval');
  const indent = unitRotationBlock(content).match(/^[\t ]*/)?.[0] ?? '\t';
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const keys = buildRotatingLightTrack(rotations.keyframes, rotations.interval, [start, start + duration], angle)
    .map(key => `${indent}\t${key.frame}: { ${key.value.join(', ')} },`);
  return [`${indent}Rotation ${keys.length} {`, `${indent}\tLinear,`, ...keys, `${indent}}`].join(newline);
}

async function ordinaryPath(root: string, relative: string): Promise<string> {
  const parts = relative.split('/');
  let current = root;
  for (let index = -1; index < parts.length; index++) {
    if (index >= 0) current = path.join(current, parts[index]);
    const info = await fs.lstat(current);
    const isFile = index === parts.length - 1;
    if (info.isSymbolicLink() || (isFile ? !info.isFile() : !info.isDirectory())) {
      throw new Error(`DNC target is not an ordinary ${isFile ? 'file' : 'directory'}: ${current}`);
    }
  }
  return current;
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const temporary = `${file}.quenching-rotation-${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

/** Caller holds the DNC directory queue through any preference commit.
 * Prepare all four edits first. A failed write/commit restores completed edits.
 * Disable restores only Rotation from the current processed profile, preserving
 * all live intensity/color values and every other byte of the model.
 */
export async function patchRotatingUnitLighting(
  dncDir: string,
  baselineDir: string,
  enabled: boolean,
  mode: string,
  brightness: unknown,
  options: DncLightingOptions,
  commitPreference?: () => void | Promise<void>,
  includeAllUnits = false,
): Promise<void> {
  const edits: { file: string; before: string; after: string }[] = [];
  const files = includeAllUnits ? (await fs.readdir(baselineDir, { recursive: true }))
    .map(file => String(file).replaceAll('\\', '/'))
    .filter(file => /unit[^/]*\.mdl$/i.test(file) && !/terrain|portrait/i.test(file)) : ROTATING_UNIT_FILES;
  for (const relative of files) {
    const file = await ordinaryPath(dncDir, relative);
    const before = await fs.readFile(file, 'utf8');
    const baseline = renderDncLighting(await fs.readFile(path.join(baselineDir, relative), 'utf8'),
      file, mode, brightness, options);
    // Even when enabling, verify that the model has the expected baseline layout.
    const baselineRotation = unitRotationBlock(baseline);
    const after = replaceUnitRotation(before, enabled && ROTATING_UNIT_FILES.includes(relative)
      ? deRotationBlock(before, options.unitLightAngle) : baselineRotation);
    if (after !== before) edits.push({ file, before, after });
  }
  const written: typeof edits = [];
  try {
    for (const edit of edits) {
      await atomicWrite(edit.file, edit.after);
      written.push(edit);
    }
    await commitPreference?.();
  } catch (error) {
    const failures: unknown[] = [];
    for (const edit of written.reverse()) {
      try { await atomicWrite(edit.file, edit.before); }
      catch (restoreError) {
        failures.push(restoreError);
        // Retain the original content if an external lock also prevents rollback.
        const recovery = `${edit.file}.quenching-rotation-recovery-${randomUUID()}.bak`;
        try { await fs.writeFile(recovery, edit.before, { encoding: 'utf8', flag: 'wx' }); }
        catch (backupError) { failures.push(backupError); }
        console.error(`[RotatingLighting] Restore failed; recovery path: ${recovery}`, restoreError);
      }
    }
    if (failures.length) throw new AggregateError([error, ...failures], 'Rotating lighting failed; rollback needs recovery');
    throw error;
  }
}
