import { getSelectedGameChannel } from './game-channel';
import { assertWar3VersionSupported } from '../../shared/war3-support';
import { GameChannel, gameChannelFolder } from '../../shared/game-channel';
import { VersionSelection, normalizeVersionSelection } from '../../shared/mod-profile';
import fs from 'fs-extra';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** UI layout retained for supported Warcraft III 2.0.4. */
export const UI_ZIP_20 = 'zip-ui-20.zip';
export const UI_ZIP_30 = 'zip-ui-30.zip';
export type UiZipName = typeof UI_ZIP_20 | typeof UI_ZIP_30;

/** Marker moves with the selected branch's shaders. */
export const SHADER_PACK_MARKER = '.quenching-shader-pack';

export type War3VersionInfo = {
    version: string;
    parts: number[];
    source: 'build.info' | 'exe' | 'unknown';
};

function normalizeWar3Root(war3Path: string): string {
    return path.normalize(war3Path.replace(/\\/g, '/').replace(/\/$/, ''));
}

export function parseVersionParts(version: string): number[] {
    const cleaned = String(version || '')
        .trim()
        .replace(/^[vV]/, '')
        .split(/[^\d]+/)
        .filter(Boolean)
        .map((n) => Number.parseInt(n, 10))
        .filter((n) => Number.isFinite(n));
    return cleaned.length > 0 ? cleaned : [0];
}

/** Known unsupported builds must never receive a supported build's UI. */
export function getUiZipForVersion(version: string | null | undefined, selection: VersionSelection = 'auto'): UiZipName {
    if (!version) {
        const explicit = normalizeVersionSelection(selection);
        if (explicit !== 'auto') return explicit === 'v204' ? UI_ZIP_20 : UI_ZIP_30;
        assertWar3VersionSupported({ parts: [0], source: 'unknown' });
    }
    const tier = assertWar3VersionSupported({ parts: parseVersionParts(version), source: 'build.info' });
    return tier === 'v204' ? UI_ZIP_20 : UI_ZIP_30;
}

async function readVersionFromBuildInfo(war3Path: string, channel: GameChannel): Promise<string | null> {
    const root = normalizeWar3Root(war3Path);
    const candidates = [
        path.join(root, gameChannelFolder(channel), '.build.info'),
        path.join(root, '.build.info'),
    ];

    for (const buildInfoPath of candidates) {
        if (!(await fs.pathExists(buildInfoPath))) {
            continue;
        }
        try {
            const raw = await fs.readFile(buildInfoPath, 'utf-8');
            const lines = raw.split(/\r?\n/).filter((l) => l.trim());
            if (lines.length < 2) {
                continue;
            }
            const headers = lines[0].split('|').map((h) => h.split('!')[0].trim().toLowerCase());
            const versionIdx = headers.findIndex((h) => h === 'version');
            if (versionIdx < 0) {
                continue;
            }
            // A shared root manifest can contain both Retail and PTR active rows.
            const productIdx = headers.findIndex((h) => h === 'product');
            const product = channel === 'ptr' ? 'w3t' : 'w3';
            let rows = lines.slice(1);
            if (productIdx >= 0) rows = rows.filter(line => (line.split('|')[productIdx] || '').trim().toLowerCase() === product);
            else if (channel === 'ptr' && buildInfoPath === path.join(root, '.build.info')) continue;
            if (!rows.length) continue;
            // Prefer the active row (Active=1) of THIS product when present.
            const activeIdx = headers.findIndex((h) => h === 'active');
            let dataLine = rows[0];
            if (activeIdx >= 0) {
                const activeRow = rows.find((line) => {
                    const cols = line.split('|');
                    return (cols[activeIdx] || '').trim() === '1';
                });
                if (activeRow) {
                    dataLine = activeRow;
                }
            }
            const version = (dataLine.split('|')[versionIdx] || '').trim();
            if (version) {
                return version;
            }
        } catch (error) {
            console.warn(`[War3Version] Failed to parse ${buildInfoPath}:`, error);
        }
    }
    return null;
}

function getExeCandidates(war3Path: string, channel: GameChannel): string[] {
    const root = normalizeWar3Root(war3Path);
    return [
        path.join(root, gameChannelFolder(channel), 'x86_64', 'Warcraft III.exe'),
        path.join(root, gameChannelFolder(channel), 'Warcraft III.exe'),
        ...(channel === 'retail' ? [
            path.join(root, 'x86_64', 'Warcraft III.exe'),
            path.join(root, 'Warcraft III.exe'),
            path.join(root, 'War3.exe'),
        ] : []),
    ];
}

async function readVersionFromExe(war3Path: string, channel: GameChannel): Promise<string | null> {
    if (process.platform !== 'win32') {
        return null;
    }

    for (const exePath of getExeCandidates(war3Path, channel)) {
        if (!(await fs.pathExists(exePath))) {
            continue;
        }
        try {
            const escaped = exePath.replace(/'/g, "''");
            const { stdout } = await execFileAsync(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    `[System.Diagnostics.FileVersionInfo]::GetVersionInfo('${escaped}').FileVersion`,
                ],
                { windowsHide: true, timeout: 15000 }
            );
            const version = String(stdout || '').trim();
            if (version) {
                return version;
            }
        } catch (error) {
            console.warn(`[War3Version] Failed to read EXE version from ${exePath}:`, error);
        }
    }
    return null;
}

export async function detectWar3Version(
    war3Path: string | undefined | null,
    channel: GameChannel = getSelectedGameChannel(),
): Promise<War3VersionInfo> {
    if (war3Path) {
        const fromBuild = await readVersionFromBuildInfo(war3Path, channel);
        if (fromBuild) return { version: fromBuild, parts: parseVersionParts(fromBuild), source: 'build.info' };
        const fromExe = await readVersionFromExe(war3Path, channel);
        if (fromExe) return { version: fromExe, parts: parseVersionParts(fromExe), source: 'exe' };
        console.warn(`[War3Version] Could not detect version for: ${war3Path}`);
    }
    return { version: '', parts: [0], source: 'unknown' };
}

export async function resolveUiZipName(war3Path: string, selection: VersionSelection = 'auto'): Promise<UiZipName> {
    const info = await detectWar3Version(war3Path);
    const zipName = getUiZipForVersion(info.version, selection);
    console.log(`[War3Version] ${info.version || 'unknown'} (${info.source}) -> ${zipName}`);
    return zipName;
}

export async function readShaderPackMarker(shadersDir: string): Promise<string | null> {
    const markerPath = path.join(shadersDir, SHADER_PACK_MARKER);
    if (!(await fs.pathExists(markerPath))) {
        return null;
    }
    try {
        return (await fs.readFile(markerPath, 'utf-8')).trim() || null;
    } catch {
        return null;
    }
}

export async function writeShaderPackMarker(shadersDir: string, zipName: string): Promise<void> {
    await fs.ensureDir(shadersDir);
    await fs.writeFile(path.join(shadersDir, SHADER_PACK_MARKER), `${zipName}\n`, 'utf-8');
}

/**
 * Some shader zips (e.g. shaders2.03.zip) store *.bls at zip root.
 * Game / toggles expect them under shaders/ps/. Move root-level .bls into ps/.
 */
export async function normalizeShaderExtractLayout(shadersDir: string): Promise<void> {
    if (!(await fs.pathExists(shadersDir))) {
        return;
    }

    const entries = await fs.readdir(shadersDir);
    const rootBls = entries.filter((name) => name.toLowerCase().endsWith('.bls'));
    if (rootBls.length === 0) {
        return;
    }

    const psDir = path.join(shadersDir, 'ps');
    await fs.ensureDir(psDir);
    for (const file of rootBls) {
        const from = path.join(shadersDir, file);
        const to = path.join(psDir, file);
        if (await fs.pathExists(to)) {
            // Both entries came from this disposable ZIP extraction. The
            // canonical ps/ entry wins when an archive contains both layouts.
            await fs.remove(from);
            continue;
        }
        await fs.move(from, to, { overwrite: false });
        console.log(`[War3Version] Normalized shader layout: ${file} -> ps/${file}`);
    }
}

export async function isShaderPackCurrent(shadersDir: string, expectedZip: string): Promise<boolean> {
    if (!(await fs.pathExists(shadersDir))) {
        return false;
    }
    const marker = await readShaderPackMarker(shadersDir);
    return marker === expectedZip;
}
