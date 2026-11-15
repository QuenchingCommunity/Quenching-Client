import fs from 'fs-extra';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { withResourceDirectory } from './resource-directory-queue';
import { defaultHdrExposure, validateHdrExposure } from '../../shared/hdr-exposure';

export const POST_PROCESSING_CONFIG_FILE = 'PostProcessingConfig.txt';

/** Copy the bundled config only when the branch does not already have one. */
export async function copyPostProcessingConfigIfMissing(buildDir: string, sourceFile: string): Promise<boolean> {
  const target = path.join(buildDir, POST_PROCESSING_CONFIG_FILE);
  try {
    await fs.copyFile(sourceFile, target, fs.constants.COPYFILE_EXCL);
    return true;
  } catch (error: any) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
}

/** Set [ASSAO] Enabled in the branch config. Returns false when the file is absent or already matches. */
export async function setPostProcessingAoEnabled(buildDir: string, enabled: boolean): Promise<boolean> {
  return setPostProcessingSectionEnabled(buildDir, 'ASSAO', enabled);
}

/** Update Tonemap atomically. Enabling it repairs missing or nonpositive exposure. */
export async function setPostProcessingTonemapEnabled(buildDir: string, enabled: boolean, exposure?: number): Promise<boolean> {
  if (exposure !== undefined) exposure = validateHdrExposure(exposure);
  return setPostProcessingSectionEnabled(buildDir, 'Tonemap', enabled, exposure);
}

export async function setPostProcessingBloomEnabled(buildDir: string, enabled: boolean): Promise<boolean> {
  return setPostProcessingSectionEnabled(buildDir, 'Bloom', enabled);
}

async function setPostProcessingSectionEnabled(buildDir: string, section: string, enabled: boolean, exposure?: number): Promise<boolean> {
  const target = path.join(buildDir, POST_PROCESSING_CONFIG_FILE);
  return withResourceDirectory(target, async () => {
    const content = await readExistingConfig(target);
    if (content === null) return false;
    const next = renderSection(content, section, enabled, exposure);
    if (next === content) return false;
    await writeConfig(target, next);
    return true;
  });
}

/** Start from the bundled template so old duplicate sections and foreign values never leak into the game. */
export async function applyPostProcessingConfigTemplate(
  buildDir: string, sourceFile: string, settings: { ao: boolean; hdr: boolean; bloom: boolean; exposure: number },
): Promise<boolean> {
  const exposure = validateHdrExposure(settings.exposure);
  const target = path.join(buildDir, POST_PROCESSING_CONFIG_FILE);
  return withResourceDirectory(target, async () => {
    const template = await fs.readFile(sourceFile, 'utf8');
    const withAo = renderSection(template, 'ASSAO', settings.ao);
    const withTonemap = renderSection(withAo, 'Tonemap', settings.hdr, exposure);
    const next = renderSection(withTonemap, 'Bloom', settings.bloom);
    const before = await readExistingConfig(target);
    if (before === next) return false;
    if (before !== null) {
      const backup = path.join(buildDir, '.quenching', 'PostProcessingConfig.before-template.txt');
      await fs.ensureDir(path.dirname(backup));
      await fs.copyFile(target, backup, fs.constants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
    }
    await writeConfig(target, next);
    return true;
  });
}

function readExistingConfig(target: string): Promise<string | null> {
  return fs.readFile(target, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

async function writeConfig(target: string, content: string): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, target);
  } finally { await fs.remove(temporary); }
}

function renderSection(content: string, section: string, enabled: boolean, exposure?: number): string {
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    // Keep each line ending, including files that mix CRLF and LF.
    const lines = content.split(/(?<=\n)/);
    const label = `[${section.toLowerCase()}]`;
    const headers = lines.flatMap((line, index) => line.trim().toLowerCase() === label ? [index] : []);
    const existingSection = headers.length > 0;
    if (!headers.length) {
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      if (lines.length && !lines[lines.length - 1].endsWith('\n')) lines[lines.length - 1] += eol;
      lines.push(eol, `[${section}]${eol}`);
      headers.push(lines.length - 1);
    }
    const tonemap = section === 'Tonemap';
    // Older/edited files can contain repeated Tonemap sections. Both the
    // first and last occurrence must yield the same state and exposure.
    const ranges = (tonemap ? headers : headers.slice(0, 1)).map(header => {
      const nextHeader = lines.findIndex((line, i) => i > header && line.trim().startsWith('['));
      return { header, end: nextHeader === -1 ? lines.length : nextHeader };
    });
    const values: Record<string, string> = { Enabled: enabled ? '1' : '0' };
    if (exposure !== undefined) values.Exposure = String(exposure);
    else if (tonemap && enabled) {
      const existing = ranges.flatMap(({ header, end }) => lines.slice(header + 1, end))
        .map(line => /^Exposure\s*=\s*(.+)$/i.exec(line.trim())?.[1].trim())
        .find(value => {
          const number = Number(value?.split(/[;#]/, 1)[0]);
          return Number.isFinite(number) && number > 0;
        });
      values.Exposure = existing ?? String(defaultHdrExposure('standard'));
    }
    for (const { header, end } of ranges.reverse()) {
      const body = lines.slice(header + 1, end);
      for (const [key, value] of Object.entries(values)) {
        const pattern = new RegExp(`^\\s*${key}\\s*=`, 'i');
        const first = body.findIndex(line => pattern.test(line));
        if (first < 0) {
          if (!lines[header].endsWith('\n')) lines[header] += eol;
          body.unshift(`${key}=${value}${eol}`);
        } else {
          const ending = /\r?\n$/.exec(body[first])?.[0] ?? '';
          body[first] = `${key}=${value}${ending}`;
          for (let i = body.length - 1; i > first; i--) {
            if (pattern.test(body[i])) body.splice(i, 1);
          }
        }
      }
      lines.splice(header + 1, end - header - 1, ...body);
    }
    const joined = lines.join('');
    return existingSection && content.endsWith('\n') ? joined : joined.replace(/\r?\n$/, '');
}
