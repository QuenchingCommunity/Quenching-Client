import { resourcePath } from '../../shared/bundled-resource-paths.mjs';
/**
 * Custom campaign (.w3n) unpack + per-map merge.
 * Mirrors legacy Quenching client (MainWindow.xaml.cs w3nloader): each scenario map must
 * receive shared campaign MPQ entries (everything in the root listfile except maps /
 * war3campImported / music / sound / UI paths) so it can run standalone; loose
 * war3campImported/music/sound are still synced to _retail_ at launch (see game-launcher).
 */
import path from 'path';
import fs from 'fs-extra';
import { Archive, MPQ_FILE_REPLACEEXISTING } from '@jamiephan/stormlib';
import { AssetSyncService } from './asset-sync';

const RESERVED_DIRS = new Set(['_merged', '_merge_work']);
const ASCII_PATH_RE = /^[\x00-\x7F]+$/;
const MPQ_INTERNAL_FILES = new Set(['(listfile)', '(signature)', '(attributes)', '(patch_metadata)']);

export type CampaignExtractProgressPhase =
    | 'prepare'
    | 'readList'
    | 'extractArchive'
    | 'discoverMaps'
    | 'mergeMap'
    | 'cleanup'
    | 'complete';

export interface CampaignExtractProgress {
    phase: CampaignExtractProgressPhase;
    percent: number;
    current?: string;
    index?: number;
    total?: number;
}

type CampaignExtractProgressHandler = (progress: CampaignExtractProgress) => void;

function parseListfileContent(raw: string): string[] {
    const t = raw.trim();
    if (!t) return [];
    if (t.includes('\n') || t.includes('\r')) {
        return t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    }
    return t.split(/\s+/).filter(Boolean);
}

function isMpqInternalFile(name: string): boolean {
    return MPQ_INTERNAL_FILES.has(name.toLowerCase());
}

/** Shared campaign resources, excluding metadata and scenario archives. */
function isExcludedFromCampaignSharedMerge(listLine: string): boolean {
    const s = listLine;
    if (isMpqInternalFile(s) || /\.w3[xm]$/i.test(s)) {
        return true;
    }
    return (
        s.includes('war3campImported')
        || s.includes('music')
        || s.includes('sound')
        || s.includes('Music')
        || s.includes('Sound')
        || s.includes('UI\\')
        || s.includes('ui\\')
    );
}

function buildSharedMergePaths(listLines: string[]): string[] {
    return listLines.filter((line) => line && !isExcludedFromCampaignSharedMerge(line));
}

function isCampaignMapListEntry(line: string): boolean {
    const t = line.trim();
    if (!/\.w3x$/i.test(t) && !/\.w3m$/i.test(t)) return false;
    if (/war3campImported/i.test(t)) return false;
    return true;
}

function discoverMapsFromListfile(listLines: string[]): string[] {
    return listLines.filter(isCampaignMapListEntry);
}

function diskPathFromInternal(root: string, internalPath: string): string {
    const parts = internalPath.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..');
    return path.join(root, ...parts);
}

async function canWriteDirectory(dir: string): Promise<boolean> {
    try {
        await fs.ensureDir(dir);
        const probe = path.join(dir, `write-test-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
        await fs.writeFile(probe, 'ok');
        await fs.remove(probe);
        return true;
    } catch {
        return false;
    }
}

async function createStormSafeWorkDir(): Promise<string> {
    const driveRoot = path.parse(process.cwd()).root;
    const candidates = [
        driveRoot ? path.join(driveRoot, 'QuenchingTemp') : '',
        process.env.PROGRAMDATA ? path.join(process.env.PROGRAMDATA, 'QuenchingModClient', 'Temp') : '',
        process.env.TEMP ? path.join(process.env.TEMP, 'QuenchingModClient') : '',
        path.join(process.cwd(), '.campaign-work')
    ].filter(Boolean).map((p) => path.normalize(p));

    for (const candidate of Array.from(new Set(candidates))) {
        if (!ASCII_PATH_RE.test(candidate)) {
            continue;
        }
        if (await canWriteDirectory(candidate)) {
            return fs.mkdtemp(path.join(candidate, 'campaign-'));
        }
    }

    throw new Error('No writable ASCII temp directory is available for StormLib campaign extraction.');
}

function extractEntireMpqToDisk(
    archive: Archive,
    destRoot: string,
    onProgress?: CampaignExtractProgressHandler
): void {
    const files = archive.listFiles();
    const total = Math.max(files.length, 1);
    files.forEach((info, index) => {
        const name = info.name;
        if (!name) return;
        const destPath = diskPathFromInternal(destRoot, name);
        try {
            fs.ensureDirSync(path.dirname(destPath));
            if (!archive.extractFile(name, destPath)) {
                console.warn(`[CampaignMerge] extract returned false: ${name}`);
            }
        } catch (e) {
            console.warn(`[CampaignMerge] extract failed (skip): ${name}`, e);
        }
        if (onProgress && (index === 0 || index === total - 1 || index % 10 === 0)) {
            onProgress({
                phase: 'extractArchive',
                percent: 12 + Math.round(((index + 1) / total) * 33),
                current: name,
                index: index + 1,
                total
            });
        }
    });
}

async function collectMapsFallback(campRoot: string): Promise<string[]> {
    const out: string[] = [];
    async function walk(absDir: string, relBase: string): Promise<void> {
        const entries = await fs.readdir(absDir, { withFileTypes: true });
        for (const ent of entries) {
            if (RESERVED_DIRS.has(ent.name)) continue;
            const rel = relBase ? path.join(relBase, ent.name) : ent.name;
            const full = path.join(campRoot, rel);
            if (ent.isDirectory()) {
                await walk(full, rel);
            } else {
                const ext = path.extname(ent.name).toLowerCase();
                if (ext === '.w3x' || ext === '.w3m') {
                    out.push(rel.split(path.sep).join('\\'));
                }
            }
        }
    }
    await walk(campRoot, '');
    return out.sort();
}

async function mergeOneMap(params: {
    campRoot: string;
    mapInternalPath: string;
    sharedPaths: string[];
    ctempTemplatePath: string;
    mergedOutPath: string;
    workDir: string;
}): Promise<void> {
    const { campRoot, mapInternalPath, sharedPaths, ctempTemplatePath, mergedOutPath, workDir } = params;

    const mapOnDisk = diskPathFromInternal(campRoot, mapInternalPath);
    if (!(await fs.pathExists(mapOnDisk))) {
        throw new Error(`Map file missing on disk: ${mapOnDisk}`);
    }

    await fs.ensureDir(path.dirname(mergedOutPath));
    await fs.copy(ctempTemplatePath, mergedOutPath, { overwrite: true });

    const mapWork = path.join(workDir, 'extract');
    await fs.remove(mapWork).catch(() => { });
    await fs.ensureDir(mapWork);

    const src = new Archive();
    src.open(mapOnDisk);

    try {
        let listRaw: string;
        try {
            listRaw = src.readFileAsString('(listfile)');
        } catch {
            throw new Error(`Map has no (listfile): ${mapInternalPath}`);
        }
        // StormLib regenerates metadata on flush; adding it as a normal file
        // is rejected, and source signatures/checksums do not describe the merged map.
        const mapListLines = parseListfileContent(listRaw).filter((name) => !isMpqInternalFile(name));

        const merged = new Archive();
        merged.open(mergedOutPath);
        try {
            const neededSlots = mapListLines.length + sharedPaths.length + 256;
            if (merged.getMaxFileCount() < neededSlots) {
                merged.setMaxFileCount(neededSlots);
            }

            const addOpts = { flags: MPQ_FILE_REPLACEEXISTING };

            for (const internalName of mapListLines) {
                const tempFile = diskPathFromInternal(mapWork, internalName);
                await fs.ensureDir(path.dirname(tempFile));
                if (!src.extractFile(internalName, tempFile)) {
                    console.warn(`[CampaignMerge] skip missing map entry: ${internalName}`);
                    continue;
                }
                if (!merged.addFile(tempFile, internalName, addOpts)) {
                    throw new Error(`Failed to add map file into merged archive: ${internalName}`);
                }
            }

            for (const shared of sharedPaths) {
                const abs = diskPathFromInternal(campRoot, shared);
                if (!(await fs.pathExists(abs))) {
                    console.warn(`[CampaignMerge] shared path missing, skip: ${shared}`);
                    continue;
                }
                if (!(await fs.stat(abs)).isFile()) {
                    continue;
                }
                if (!merged.addFile(abs, shared, addOpts)) {
                    throw new Error(`Failed to add shared file into merged map: ${shared}`);
                }
            }

            merged.flush();
        } finally {
            merged.close();
        }
    } finally {
        src.close();
    }
}

export async function extractCampaignW3nMerged(
    w3nPath: string,
    outputDir: string,
    onProgress?: CampaignExtractProgressHandler
): Promise<{ outputDir: string; maps: string[] }> {
    const report = (progress: CampaignExtractProgress) => onProgress?.(progress);
    const finalOutputDir = path.resolve(outputDir);
    let workRoot = '';
    report({ phase: 'prepare', percent: 2 });

    const ctempPath = resourcePath(path.join(await AssetSyncService.getAssetsDir(["camp"]), 'quenching'), 'camp', 'ctemp.w3x');

    if (!(await fs.pathExists(ctempPath))) {
        throw new Error(`Missing merge template ctemp.w3x at ${ctempPath}`);
    }
    if (!(await fs.pathExists(w3nPath))) {
        throw new Error(`w3n not found: ${w3nPath}`);
    }

    const needsStormSafePaths = !ASCII_PATH_RE.test(path.resolve(w3nPath)) || !ASCII_PATH_RE.test(finalOutputDir);

    try {
        let stormW3nPath = path.resolve(w3nPath);
        let activeOutputDir = finalOutputDir;

        if (needsStormSafePaths) {
            workRoot = await createStormSafeWorkDir();
            stormW3nPath = path.join(workRoot, 'source.w3n');
            activeOutputDir = path.join(workRoot, 'out');
            await fs.copy(w3nPath, stormW3nPath, { overwrite: true });
            await fs.ensureDir(activeOutputDir);
        } else {
            await fs.remove(finalOutputDir).catch(() => { });
            await fs.ensureDir(finalOutputDir);
        }

        const root = new Archive();
        root.open(stormW3nPath);
        report({ phase: 'readList', percent: 8 });

        let listLines: string[];
        try {
            const listRaw = root.readFileAsString('(listfile)');
            listLines = parseListfileContent(listRaw);
        } catch (e: any) {
            root.close();
            throw new Error(`Campaign archive has no (listfile): ${e?.message || e}`);
        }

        extractEntireMpqToDisk(root, activeOutputDir, report);
        root.close();

        report({ phase: 'discoverMaps', percent: 48 });
        let mapEntries = discoverMapsFromListfile(listLines);
        if (mapEntries.length === 0) {
            const relPaths = await collectMapsFallback(activeOutputDir);
            mapEntries = relPaths;
        }

        const sharedPaths = buildSharedMergePaths(listLines);
        const mergedDir = path.join(activeOutputDir, '_merged');
        const workDir = path.join(activeOutputDir, '_merge_work');
        await fs.ensureDir(mergedDir);
        await fs.remove(workDir).catch(() => { });
        await fs.ensureDir(workDir);

        const mergedMapPaths: string[] = [];
        let idx = 0;
        const totalMaps = Math.max(mapEntries.length, 1);
        for (const mapRel of mapEntries) {
            const mapOnDisk = diskPathFromInternal(activeOutputDir, mapRel);
            if (!(await fs.pathExists(mapOnDisk))) {
                console.warn(`[CampaignMerge] listfile map not on disk, skip: ${mapRel}`);
                continue;
            }
            const ext = path.extname(mapRel) || '.w3x';
            const base = path.basename(mapRel, ext);
            const mergedName = `${base}_merged${ext}`;
            const mergedOut = path.join(mergedDir, mergedName);
            try {
                report({
                    phase: 'mergeMap',
                    percent: 50 + Math.round((idx / totalMaps) * 43),
                    current: mapRel,
                    index: idx + 1,
                    total: totalMaps
                });
                await mergeOneMap({
                    campRoot: activeOutputDir,
                    mapInternalPath: mapRel,
                    sharedPaths,
                    ctempTemplatePath: ctempPath,
                    mergedOutPath: mergedOut,
                    workDir: path.join(workDir, `slot_${idx++}`)
                });
                mergedMapPaths.push(mergedOut);
            } catch (e) {
                console.error(`[CampaignMerge] failed for ${mapRel}:`, e);
                throw e;
            }
        }

        report({ phase: 'cleanup', percent: 96 });
        await fs.remove(workDir).catch(() => { });

        if (mergedMapPaths.length === 0) {
            throw new Error('No playable maps were produced after merge (empty .w3n or unsupported layout)');
        }

        mergedMapPaths.sort();

        if (needsStormSafePaths) {
            await fs.remove(finalOutputDir).catch(() => { });
            await fs.ensureDir(path.dirname(finalOutputDir));
            await fs.copy(activeOutputDir, finalOutputDir, { overwrite: true });
        }

        const finalMapPaths = mergedMapPaths.map((p) => path.join(finalOutputDir, path.relative(activeOutputDir, p)));
        report({ phase: 'complete', percent: 100, total: finalMapPaths.length });
        return { outputDir: finalOutputDir, maps: finalMapPaths };
    } finally {
        if (workRoot) {
            await fs.remove(workRoot).catch((e) => console.warn(`[CampaignMerge] failed to remove work dir ${workRoot}:`, e));
        }
    }
}
