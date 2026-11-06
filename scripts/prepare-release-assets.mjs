import { resourcePath } from '../src/shared/bundled-resource-paths.mjs';
// Keep visible release text consistent without editing or regenerating PNGs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { releaseLabel } from './lib/release-label.mjs';
import { UI_PUBLIC_ARCHIVE, UI_VARIANT_ARCHIVES } from './split-ui-archives.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const UI_ARCHIVES = UI_VARIANT_ARCHIVES;
export const UI_VERSION_FILES = Object.freeze(['framedef/ui/commandbar.fdf', 'ui-que/framedef/ui/commandbar.fdf']);
const uiFrame = /(\bString\s+"QuenchingVersionText"\s*\{)([^}]*)(\})/g;
const isBackup = name => name.split('/').some(part => part.toLowerCase() === 'backup');
function validateVersionFiles(file, frames, versionFiles) {
  if (frames !== UI_VERSION_FILES.length || UI_VERSION_FILES.some(name => !versionFiles.has(name))) {
    throw new Error(`${path.basename(file)}: expected ${UI_VERSION_FILES.length} active UIQUE version fields at ${UI_VERSION_FILES.join(', ')}, found ${frames}`);
  }
}

function endOfFrame(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error('UIQUE has an unclosed comment');
      i = end + 1;
    } else if (text[i] === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
    } else if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i + 1;
  }
  throw new Error('UIQUE has an unclosed frame');
}

function ensureVersionFont(text, check) {
  const parents = [...text.matchAll(/\bFrame\s+"SIMPLEFRAME"\s+"CommandBarFrame"\s*\{/g)];
  if (parents.length !== 1) throw new Error('UIQUE version must have one SIMPLEFRAME CommandBarFrame parent');
  const open = text.indexOf('{', parents[0].index);
  const end = endOfFrame(text, open);
  const version = [...text.matchAll(uiFrame)];
  if (version.length !== 1 || version[0].index < open || version[0].index + version[0][0].length > end) {
    throw new Error('UIQUE version String must belong to CommandBarFrame');
  }
  if (!/\bFont\s+"MasterFont"\s*,\s*0\.0*1\s*,/.test(version[0][2])) {
    throw new Error('UIQUE version must define its MasterFont at size 0.01');
  }
  const body = text.slice(open + 1, end - 1);
  const child = body.search(/\b(?:Frame|String|Texture|Layer)\s+"/);
  const header = child < 0 ? body : body.slice(0, child);
  if (/^[\t ]*DecorateFileNames\s*,/m.test(header)) return text;
  if (check) throw new Error('UIQUE version font is invisible: CommandBarFrame needs DecorateFileNames');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  return text.slice(0, open + 1) + `${newline}\tDecorateFileNames,` + text.slice(open + 1);
}

export function renderWebUI(template, displayVersion, channel = 'production') {
  const label = releaseLabel({ displayVersion, channel });
  if (!template.includes('{{QUENCHING_DISPLAY_VERSION}}')) throw new Error('WebUI template is missing the release version token');
  return template.replaceAll('{{QUENCHING_DISPLAY_VERSION}}', label);
}

export function updateUiVersionText(text, displayVersion, check = false) {
  let frames = 0;
  let result = text.replace(uiFrame, (frame, start, body, end) => {
    frames++;
    const texts = [...body.matchAll(/\bText\s+"([^"]*)"/g)];
    if (texts.length !== 1) throw new Error('UIQUE version frame must contain exactly one Text field');
    if (check && texts[0][1] !== `V${displayVersion}`) throw new Error(`UIQUE version is ${texts[0][1]}, expected V${displayVersion}`);
    return start + body.replace(/(\bText\s+")[^"]*(")/, `$1V${displayVersion}$2`) + end;
  });
  if (frames) result = ensureVersionFont(result, check);
  return { text: result, frames };
}

export async function prepareUiArchive(file, displayVersion, { check = false, validateOnly = false } = {}) {
  const expanded = path.resolve(path.dirname(file), '..', 'unpacked/packages', path.basename(file, '.zip'));
  if ((await fs.stat(expanded).catch(() => null))?.isDirectory()) {
    let frames = 0, changedFiles = 0;
    const pending = [], versionFiles = new Set();
    const visit = async folder => {
      for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
        if (entry.name.toLowerCase() === 'backup') continue;
        const full = path.join(folder, entry.name);
        if (entry.isSymbolicLink()) throw new Error('UI source cannot contain links');
        if (entry.isDirectory()) await visit(full);
        else {
          if (!/\.fdf$/i.test(entry.name)) throw new Error(`${path.basename(file)} must contain only version-specific FDF files`);
          const before = await fs.readFile(full, 'utf8');
          const updated = updateUiVersionText(before, displayVersion, check);
          const relative = path.relative(expanded, full).split(path.sep).join('/');
          if (updated.frames) {
            if (!UI_VERSION_FILES.includes(relative)) throw new Error(`${path.basename(file)}: unexpected UIQUE version field in ${relative}`);
            versionFiles.add(relative);
          }
          frames += updated.frames;
          if (updated.text !== before) { pending.push([full, updated.text]); changedFiles++; }
        }
      }
    };
    await visit(expanded);
    validateVersionFiles(file, frames, versionFiles);
    if (!check && !validateOnly) for (const [full, text] of pending) await fs.writeFile(full, text);
    return { archive: path.basename(file), frames, changedFiles };
  }
  const original = await fs.readFile(file);
  const zip = await JSZip.loadAsync(original);
  let frames = 0, changedFiles = 0;
  const versionFiles = new Set();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || isBackup(entry.name) || !entry.name.toLowerCase().endsWith('.fdf')) continue;
    const before = await entry.async('nodebuffer');
    const updated = updateUiVersionText(before.toString('utf8'), displayVersion, check);
    frames += updated.frames;
    if (updated.frames) {
      if (!UI_VERSION_FILES.includes(entry.name)) throw new Error(`${path.basename(file)}: unexpected UIQUE version field in ${entry.name}`);
      versionFiles.add(entry.name);
    }
    if (updated.frames && updated.text !== before.toString('utf8')) {
      changedFiles++;
      zip.file(entry.name, Buffer.from(updated.text), { date: entry.date, comment: entry.comment,
        unixPermissions: entry.unixPermissions, dosPermissions: entry.dosPermissions, createFolders: false });
    }
  }
  validateVersionFiles(file, frames, versionFiles);
  if (!check && !validateOnly && changedFiles) {
    // JSZip normalizes the old './' root directory to '/'; don't emit an absolute entry.
    delete zip.files['/'];
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const temporary = `${file}.version-${process.pid}.tmp`;
    try {
      await fs.writeFile(temporary, bytes, { flag: 'wx' });
      for (let attempt = 0; ; attempt++) {
        try { await fs.rename(temporary, file); break; }
        catch (error) {
          if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 8) throw error;
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  return { archive: path.basename(file), frames, changedFiles };
}

async function writeOrCheck(file, bytes, check) {
  const previous = await fs.readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (previous?.equals(bytes)) return false;
  if (check) throw new Error(`Release asset is stale: ${file}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
  return true;
}

export async function prepareReleaseAssets({ root = projectRoot, check = false, latestRoot } = {}) {
  const release = JSON.parse(await fs.readFile(path.join(root, 'release-version.json'), 'utf8'));
  const { displayVersion } = release;
  const label = releaseLabel(release);
  const { version: internalVersion } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(internalVersion) || !(internalVersion === displayVersion || internalVersion.startsWith(displayVersion + '.'))) {
    throw new Error('Client internal version and public release version belong to different releases');
  }
  const q = path.join(root, 'assets', 'quenching');
  const publicDir = path.resolve(q, '../unpacked/packages', path.basename(UI_PUBLIC_ARCHIVE, '.zip'));
  const expandedUi = (await fs.stat(publicDir).catch(() => null))?.isDirectory();
  const publicFiles = [];
  if (expandedUi) {
    const visit = async folder => {
      for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
        if (entry.name.toLowerCase() === 'backup') continue;
        if (entry.isSymbolicLink()) throw new Error('UI source cannot contain links');
        if (entry.isDirectory()) await visit(path.join(folder, entry.name));
        else publicFiles.push({ name: entry.name });
      }
    };
    await visit(publicDir);
  } else {
    const publicZip = await JSZip.loadAsync(await fs.readFile(path.join(q, UI_PUBLIC_ARCHIVE)));
    publicFiles.push(...Object.values(publicZip.files).filter(entry => !entry.dir));
  }
  if (!publicFiles.length || publicFiles.some(entry => /\.fdf$/i.test(entry.name))) {
    throw new Error(`${UI_PUBLIC_ARCHIVE} must contain only shared non-FDF UI assets`);
  }
  const template = await fs.readFile(path.join(root, 'scripts/templates/quenching-webui.html'), 'utf8');
  const html = Buffer.from(renderWebUI(template, displayVersion, release.channel));
  // Check all version-bearing inputs before writing any generated output.
  for (const archive of UI_ARCHIVES) {
    if (expandedUi) {
      // Inspect before any generated output is changed; writes occur below.
      await prepareUiArchive(path.join(q, archive), label, { check, validateOnly: true });
      continue;
    }
    const bytes = await fs.readFile(path.join(q, archive));
    const z = await JSZip.loadAsync(bytes);
    if (Object.values(z.files).some(entry => !entry.dir && !isBackup(entry.name) && !/\.fdf$/i.test(entry.name))) {
      throw new Error(`${archive} must contain only version-specific FDF files`);
    }
    await prepareUiArchive(path.join(q, archive), label, { check, validateOnly: true });
  }
  const images = new Map();
  for (const name of ['QuenchingOnCN.png', 'QuenchingOnEN.png']) images.set(name, await fs.readFile(resourcePath(q, 'tx', name)));
  const htmlChanged = await writeOrCheck(path.join(q, 'index.html'), html, check);
  const identity = Buffer.from(JSON.stringify({ schema: 1, product: 'quenching-local-build',
    displayVersion, internalVersion, channel: release.channel || 'production', label }, null, 2) + '\n');
  const identityChanged = await writeOrCheck(path.join(q, 'local-release.json'), identity, check);
  const ui = [];
  for (const archive of UI_ARCHIVES) ui.push(await prepareUiArchive(path.join(q, archive), label, { check }));
  let latest;
  if (latestRoot) {
    // Explicit resource edit only; no _patch version/sequence or release manifest is changed.
    const webui = path.join(path.resolve(latestRoot), 'webui');
    const indexChanged = await writeOrCheck(path.join(webui, 'index.html'), html, check);
    const imageChanged = await writeOrCheck(path.join(webui, 'QuenchingOn.png'), images.get('QuenchingOnCN.png'), check);
    const identityChanged = await writeOrCheck(path.join(path.resolve(latestRoot), 'local-release.json'), identity, check);
    latest = { webui, indexChanged, imageChanged, identityChanged };
  }
  return { displayVersion, channel: release.channel || 'production', label, internalVersion, check, htmlChanged, identityChanged, ui, ...(latest ? { latest } : {}) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--check', '--sync-latest'].includes(arg))) throw new Error('Usage: node scripts/prepare-release-assets.mjs [--check] [--sync-latest]');
  const result = await prepareReleaseAssets({ check: args.includes('--check'),
    ...(args.includes('--sync-latest') ? { latestRoot: 'D:/Quenching/QM/Latest' } : {}) });
  console.log(JSON.stringify(result));
}
