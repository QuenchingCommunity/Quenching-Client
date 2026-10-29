/** Maintain diffuse-based terrain choices and partial T30 SLK overrides from CASC.
 * node scripts/prepare-decisive-terrain.mjs --game-root GAME --full-package QMF [--write]
 * This is an asset maintenance task; the client never scans/extracts CASC at startup.
 */
import fs from 'fs-extra';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readSlkTable, patchSlkCells } from './terrain-slk-utils.mjs';

const { Storage } = createRequire(import.meta.url)('@jamiephan/casclib');
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (!args.includes('--game-root') || !args.includes('--full-package')) throw new Error('Pass --game-root and --full-package');
const gameRoot = path.resolve(option('--game-root'));
const fullRoot = path.resolve(option('--full-package'));
const t30 = path.join(fullRoot, 't30');
const activeTerrain = (await fs.readFile(path.join(fullRoot, 'terrainart/meta.que'), 'utf8').catch(() => '')).trim();
const channels = ['diffuse', 'normal', 'orm'];
const normalize = value => value.replaceAll('\\', '/').toLowerCase();
const families = new Map();
async function walk(directory, relative = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const child = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) await walk(path.join(directory, entry.name), child);
        else {
            const match = /^(.*)_(diffuse|normal|orm)\.(dds|tif)$/i.exec(child);
            if (!match) continue;
            const family = normalize(match[1]);
            if (!families.has(family)) families.set(family, new Map());
            families.get(family).set(match[2].toLowerCase(), child);
        }
    }
}
await walk(t30);
const native = {};
const extracted = [];
const otherTables = [];
const textureDirectoryCache = new Map();
async function textureExists(family, channel) {
    const directory = path.dirname(path.join(fullRoot, family));
    if (!textureDirectoryCache.has(directory)) {
        textureDirectoryCache.set(directory, new Set((await fs.readdir(directory).catch(error => {
            if (error.code === 'ENOENT') return [];
            throw error;
        })).map(name => name.toLowerCase())));
    }
    const names = textureDirectoryCache.get(directory);
    return ['dds', 'tif'].some(ext => names.has(`${path.basename(family)}_${channel}.${ext}`.toLowerCase()));
}
const storage = new Storage();
try {
    storage.open(`${gameRoot}*w3`);
    for (const type of ['terrain', 'clifftypes']) {
        const file = storage.openFile(`war3.w3mod:terrainart\\${type}.slk`);
        try { native[type] = file.readAll().toString('latin1'); } finally { file.close(); }
    }
    // Native filename lookup also resolves old misplaced copies (e.g. Lords_*
    // under LordaeronFall, and the nested Ashenvale copy under Felwood).
    const nativeFamilies = new Set();
    for (const [type, text] of Object.entries(native)) {
        for (const row of readSlkTable(text).rows.values()) {
            const dir = row.get(type === 'terrain' ? 'dir' : 'texDir');
            const file = row.get(type === 'terrain' ? 'file' : 'texFile');
            nativeFamilies.add(normalize(`${dir}/${file}`).replace(/^terrainart\//, ''));
        }
    }
    for (const [family, maps] of families) {
        if (!maps.has('diffuse')) continue;
        for (const channel of channels) {
            if (maps.has(channel)) continue;
            const stem = path.posix.basename(family);
            const alternatives = [...nativeFamilies].filter(name => path.posix.basename(name) === stem && name !== family);
            if (alternatives.length > 1) throw new Error(`Ambiguous native texture family: ${family}`);
            let source;
            for (const original of [family, ...alternatives]) {
                for (const layer of ['_de.w3mod:', '_hd.w3mod:']) {
                    for (const ext of ['dds', 'tif']) {
                        const candidate = `war3.w3mod:${layer}terrainart\\${original.replaceAll('/', '\\')}_${channel}.${ext}`;
                        if (storage.fileExists(candidate)) { source = candidate; break; }
                    }
                    if (source) break;
                }
                if (source) break;
            }
            if (!source) throw new Error(`Missing CASC texture: ${family}_${channel}`);
            const file = storage.openFile(source);
            let bytes;
            try { bytes = file.readAll(); } finally { file.close(); }
            if (!bytes.length) throw new Error(`Empty CASC texture: ${source}`);
            const relative = `${family}_${channel}${path.extname(source)}`;
            maps.set(channel, relative);
            extracted.push({ relative, source, bytes });
        }
    }
    // The older choices use the same diffuse rule. In particular, generic
    // ReplaceableTextures\Cliff entries without package artwork must stay native.
    for (const era of ['00', '16', '18', '20']) {
        for (const type of ['terrain', 'clifftypes']) {
            const target = path.resolve('assets/unpacked/tile', `${type}${era}.slk`);
            const content = await fs.readFile(target, 'latin1');
            const original = readSlkTable(native[type]);
            const updates = new Map();
            const dirField = type === 'terrain' ? 'dir' : 'texDir';
            const fileField = type === 'terrain' ? 'file' : 'texFile';
            for (const [id, row] of readSlkTable(content).rows) {
                if (/^terrainart\\/i.test(row.get(dirField))) continue;
                const base = original.rows.get(id);
                const family = normalize(`${row.get(dirField)}/${row.get(fileField)}`);
                if (!await textureExists(family, 'diffuse')) {
                    updates.set(id, new Map([[dirField, base.get(dirField)], [fileField, base.get(fileField)]]));
                    continue;
                }
                for (const channel of ['normal', 'orm']) {
                    if (await textureExists(family, channel)) continue;
                    if (extracted.some(item => item.fullRelative === `${family}_${channel}.dds` || item.fullRelative === `${family}_${channel}.tif`)) continue;
                    const originalFamily = normalize(`${base.get(dirField)}/${base.get(fileField)}`);
                    let source;
                    for (const layer of ['_de.w3mod:', '_hd.w3mod:']) {
                        for (const ext of ['dds', 'tif']) {
                            const candidate = `war3.w3mod:${layer}${originalFamily.replaceAll('/', '\\')}_${channel}.${ext}`;
                            if (storage.fileExists(candidate)) { source = candidate; break; }
                        }
                        if (source) break;
                    }
                    if (!source) throw new Error(`Missing CASC map for ${type}${era}.${id}: ${channel}`);
                    const file = storage.openFile(source);
                    let bytes;
                    try { bytes = file.readAll(); } finally { file.close(); }
                    extracted.push({ fullRelative: `${family}_${channel}${path.extname(source)}`, source, bytes });
                }
            }
            otherTables.push({ era, type, target, bytes: Buffer.from(patchSlkCells(content, updates), 'latin1'), restoredNative: [...updates.keys()] });
        }
    }
} finally { storage.close(); }

// T30's old fall cliffs use the summer names. Preserve their customized diffuse
// files, and select these exact names rather than redirecting to missing Lordf_*.
const aliases = new Map([
    ['lordaeronfall/lordf_cliff0', 'lordaeronfall/lords_cliff0'],
    ['lordaeronfall/lordf_cliff1', 'lordaeronfall/lords_cliff1'],
]);
const tables = [];
for (const [type, content] of Object.entries(native)) {
    const updates = new Map();
    const dirField = type === 'terrain' ? 'dir' : 'texDir';
    const fileField = type === 'terrain' ? 'file' : 'texFile';
    for (const [id, row] of readSlkTable(content).rows) {
        const original = normalize(`${row.get(dirField)}/${row.get(fileField)}`).replace(/^terrainart\//, '');
        const family = families.get(original)?.has('diffuse') ? original : aliases.get(original);
        if (!family || !families.get(family)?.has('diffuse')) continue;
        const fields = new Map([[dirField, `t30\\${path.posix.dirname(family).replaceAll('/', '\\')}`]]);
        if (family !== original) fields.set(fileField, path.posix.basename(family));
        updates.set(id, fields);
    }
    tables.push({ type, bytes: Buffer.from(patchSlkCells(content, updates), 'latin1'), overrides: [...updates.keys()] });
}
const report = {
    gameRoot, fullRoot, buildInfo: await fs.readFile(path.join(gameRoot, '.build.info'), 'utf8'),
    textureFamilies: families.size,
    diffuseFamilies: [...families.values()].filter(maps => maps.has('diffuse')).length,
    ignoredWithoutDiffuse: [...families].filter(([, maps]) => !maps.has('diffuse')).map(([family]) => family),
    extracted: extracted.map(({ bytes, ...item }) => ({ ...item, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') })),
    tables: tables.map(({ type, overrides }) => ({ type, nativeRecords: readSlkTable(native[type]).rows.size, overrides })),
    otherTables: otherTables.map(({ era, type, restoredNative }) => ({ era, type, restoredNative })),
};
if (args.includes('--write')) {
    for (const item of extracted) await fs.outputFile(item.fullRelative ? path.join(fullRoot, item.fullRelative) : path.join(t30, item.relative), item.bytes);
    for (const { type, bytes } of tables) {
        await fs.outputFile(path.resolve('assets/unpacked/tile', `${type}30.slk`), bytes);
        await fs.outputFile(path.join(t30, `${type}.slk`), bytes);
    }
    for (const { era, type, target, bytes } of otherTables) {
        await fs.outputFile(target, bytes);
        // Refresh existing full-package table copies without changing its
        // current active terrain selection or creating missing active files.
        const relative = type === 'terrain' ? 'terrain.slk' : 'clifftypes.slk';
        const targets = era === '20' ? [`terrainart/_setting/${relative}`, ...(activeTerrain === '20' ? [`terrainart/${relative}`] : [])]
            : [`t${era}/${relative}`, `t${era}/terrain-que/${relative}`];
        for (const copy of targets) {
            const output = path.join(fullRoot, copy);
            if (await fs.pathExists(output)) await fs.outputFile(output, bytes);
        }
    }
    await fs.outputJson(path.join(fullRoot, '_reports', 't30-slk-textures.json'), report, { spaces: 2 });
}
console.log(JSON.stringify({ write: args.includes('--write'), textureFamilies: families.size, missingMaps: extracted.length,
    tables: report.tables.map(({ type, nativeRecords, overrides }) => ({ type, nativeRecords, overriddenRecords: overrides.length })),
    restoredNative: report.otherTables.filter(item => item.restoredNative.length),
    sources: [...new Set(report.extracted.map(item => item.source.split('terrainart')[0]))] }, null, 2));
