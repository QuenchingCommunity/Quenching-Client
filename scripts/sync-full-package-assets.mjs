import { resourcePath } from "../src/shared/bundled-resource-paths.mjs";
/** Sync the HD 3.01 / Standard / brightness-3 baseline into the QMF maintenance tree.
 * Default is read-only; --write backs up changed destinations before copying.
 * This does not create release ZIPs, modify version markers or publish manifests.
 */
import fs from 'fs-extra';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { alignPackageDestructables } from './full-package-sync-utils.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => arg.startsWith('--') && arg !== '--write')) throw new Error('Usage: node scripts/sync-full-package-assets.mjs [LATEST_ROOT] [--write]');
const roots = args.filter(arg => arg !== '--write');
if (roots.length > 1) throw new Error('Provide at most one Latest root');
const root = path.resolve(roots[0] || 'D:/Quenching/QM/Latest');
const assets = path.join(repo, 'assets', 'quenching');
if (!(await fs.pathExists(path.join(root, '_patch', 'keep.que')))) throw new Error('QMF version marker is missing');
if (await fs.pathExists(path.join(root, '_manual'))) throw new Error('Latest/_manual is retired; remove it explicitly before synchronizing the default baseline');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function filesUnder(directory, prefix = '') {
    const files = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error(`Resource source contains a link: ${directory}/${entry.name}`);
        const relative = path.join(prefix, entry.name);
        if (entry.isDirectory()) files.push(...await filesUnder(path.join(directory, entry.name), relative));
        else if (entry.isFile()) files.push(relative);
    }
    return files.sort();
}
const plans = [];
const trees = [
    ['shaders/vs', 'shaders/shaders-300-hd/vs'],
    ['shaders/ps', 'shaders/shaders-300-hd/ps/standard'],
    // Modern DNC templates already contain the finalized level-3 values.
    ['environment/dnc', 'dnc/dnc30-hd'],
    ['replaceabletextures/water-rel', 'water/water-rel'],
    ['replaceabletextures/water-trans', 'water/water-trans'],
];
async function planFile(relative, source) {
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) throw new Error(`Target escapes the QMF tree: ${relative}`);
    const bytes = Buffer.isBuffer(source) ? source : await fs.readFile(source);
    const before = await fs.pathExists(target) ? await fs.readFile(target) : null;
    plans.push({ relative: relative.replace(/\\/g, '/'), target, bytes, beforeSha256: before ? sha(before) : null, sha256: sha(bytes) });
}
for (const [destination, template] of trees) {
    const source = resourcePath(assets, template);
    const files = await filesUnder(source);
    const target = path.join(root, destination);
    const extras = await fs.pathExists(target) ? (await filesUnder(target)).filter(file => !files.includes(file)) : [];
    // Unrelated extra files are not a license to remove whole resource folders.
    if (extras.length) throw new Error(`${destination}: extra files need inspection: ${extras.join(', ')}`);
    for (const file of files) await planFile(path.join(destination, file), path.join(source, file));
}
for (const name of ['shoreline1.dds', 'shorelineparticlexy.dds']) {
    for (const folder of ['textures/fx', 'textures/_setting']) await planFile(`${folder}/${name}`, resourcePath(assets, 'water', 'shoreline', name));
}
await planFile('units/unitskin.txt', resourcePath(assets, 'skin', 'unitskin-new.txt'));
await planFile('PostProcessingConfig.txt', resourcePath(assets, 'PostProcessingConfig.txt'));
await planFile('webui/index.html', resourcePath(assets, 'index.html'));
await planFile('webui/QuenchingOn.png', resourcePath(assets, 'tx', 'QuenchingOnCN.png'));
const skin = alignPackageDestructables(
    await fs.readFile(resourcePath(assets, 'skin', 'destructableskin.txt'), 'utf8'),
    await fs.readFile(resourcePath(assets, 'skin', 'legacy', 'destructableskin.txt'), 'utf8'),
    await fs.readFile(path.join(root, 'units', 'destructableskin.txt'), 'utf8'),
);
await planFile('units/destructableskin.txt', Buffer.from(skin.content, 'utf8'));

// Keep original-water and parked T30 defaults. Only refresh tables already in use.
const tiles = [
    ['t30/terrain.slk', 'terrain30.slk'],
    ['t30/clifftypes.slk', 'clifftypes30.slk'],
    ['terrainart/terrain.slk', 'terrain20.slk'],
    ['terrainart/clifftypes.slk', 'clifftypes20.slk'],
    ['terrainart/_setting/terrain.slk', 'terrain20.slk'],
    ['terrainart/_setting/clifftypes.slk', 'clifftypes20.slk'],
    ['terrainart/_setting/water.slk', 'water-trans.slk'],
    ...['00', '16', '18'].map(era => [`t${era}/clifftypes.slk`, `clifftypes${era}.slk`]),
    ...['16', '18'].flatMap(era => [
        [`t${era}/terrain-que/clifftypes.slk`, `clifftypes${era}.slk`],
        [`t${era}/terrain-que/terrain.slk`, `terrain${era}.slk`],
        [`t${era}/terrain-que/water.slk`, 'water-trans.slk'],
    ]),
];
for (const [relative, template] of tiles) {
    if (await fs.pathExists(path.join(root, relative))) await planFile(relative, resourcePath(assets, 'tile', template));
}

const changed = plans.filter(plan => plan.beforeSha256 !== plan.sha256);
console.log(`Mapped files: ${plans.length}; changed: ${changed.length}; destructable records: ${skin.records}; preserved MOD overrides: ${skin.overrides.length}`);
for (const plan of changed) console.log(plan.relative);
if (process.argv.includes('--write') && changed.length) {
    const parent = path.join(repo, '_tmp');
    await fs.ensureDir(parent);
    const backup = await fs.mkdtemp(path.join(parent, 'latest-resource-sync-'));
    for (const plan of changed) {
        if (plan.beforeSha256) await fs.copy(plan.target, path.join(backup, 'originals', plan.relative), { overwrite: false, errorOnExist: true });
    }
    await fs.outputJson(path.join(backup, 'report.json'), {
        root, assets, overrides: skin.overrides,
        files: changed.map(({ relative, beforeSha256, sha256 }) => ({ relative, beforeSha256, sha256 })),
    }, { spaces: 2 });
    for (const plan of changed) await fs.outputFile(plan.target, plan.bytes);
    console.log(`Updated ${changed.length} files; backup: ${backup}`);
}
