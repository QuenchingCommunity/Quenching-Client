/** Read-only validation of every selectable table and the actual maintained textures. */
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSlkTable } from './terrain-slk-utils.mjs';
const { Storage } = createRequire(import.meta.url)('@jamiephan/casclib');
const [gameRoot, fullRoot] = process.argv.slice(2);
assert(gameRoot && fullRoot, 'Pass GAME_ROOT FULL_PACKAGE_ROOT');
const native = {};
const storage = new Storage();
try {
    storage.open(`${gameRoot}*w3`);
    for (const type of ['terrain', 'clifftypes']) {
        const file = storage.openFile(`war3.w3mod:terrainart\\${type}.slk`);
        try { native[type] = readSlkTable(file.readAll().toString('latin1')); } finally { file.close(); }
    }
} finally { storage.close(); }
const inventory = new Set();
async function walk(directory, relative = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
        const child = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) await walk(path.join(directory, entry.name), child);
        else inventory.add(child.toLowerCase());
    }
}
await walk(fullRoot);
const normalize = value => value.replaceAll('\\', '/').toLowerCase();
const hasMap = (family, channel) => ['dds', 'tif'].some(ext => inventory.has(`${family}_${channel}.${ext}`));
const rows = [];
for (const era of ['00', '16', '18', '20', '30']) {
    let changed = 0;
    for (const type of ['terrain', 'clifftypes']) {
        const bytes = await fs.readFile(`assets/unpacked/tile/${type}${era}.slk`);
        const table = readSlkTable(bytes.toString('latin1'));
        assert.deepEqual([...table.headers], [...native[type].headers], `${type}${era}: all native fields must survive`);
        assert.deepEqual([...table.rows.keys()], [...native[type].rows.keys()], `${type}${era}: all native records must survive`);
        const dirField = type === 'terrain' ? 'dir' : 'texDir';
        const fileField = type === 'terrain' ? 'file' : 'texFile';
        for (const [id, row] of table.rows) {
            const base = native[type].rows.get(id);
            for (const [field, value] of base) {
                if (field === dirField || (type === 'clifftypes' && field === fileField)) continue;
                assert.equal(row.get(field), value, `${type}${era}: ${id}.${field} must stay native`);
            }
            const custom = row.get(dirField) !== base.get(dirField) || row.get(fileField) !== base.get(fileField);
            if (!custom) continue;
            changed++;
            const family = normalize(`${row.get(dirField)}/${row.get(fileField)}`);
            assert(hasMap(family, 'diffuse'), `${type}${era}: ${id} must stay native without a customized diffuse`);
            for (const channel of ['normal', 'orm']) assert(hasMap(family, channel), `${type}${era}: missing ${id} ${channel}`);
        }
        if (era === '30') {
            assert(bytes.equals(await fs.readFile(path.join(fullRoot, 't30', `${type}.slk`))), `${type}30: full-package copy differs`);
            if (type === 'terrain') {
                assert.equal(table.rows.get('Bdrt')?.get('dir'), native[type].rows.get('Bdrt')?.get('dir'), 'missing Barrens diffuse must retain native routing');
            } else {
                assert.equal(table.rows.get('CFdi').get('texDir'), 't30\\lordaeronfall');
                assert.equal(table.rows.get('CFdi').get('texFile'), 'lords_cliff0', 'fall cliff must use the customized existing filename');
            }
        }
    }
    rows.push({ era, terrainRecords: native.terrain.rows.size, cliffRecords: native.clifftypes.rows.size, customRecords: changed });
}
let diffuseFamilies = 0;
for (const file of inventory) {
    const match = /^t30\/(.*)_diffuse\.(dds|tif)$/.exec(file);
    if (!match) continue;
    diffuseFamilies++;
    for (const channel of ['normal', 'orm']) assert(hasMap(`t30/${match[1]}`, channel), `T30 ${match[1]}: missing ${channel}`);
}
assert(!hasMap('t30/lordaeronwinter/lords_dirt', 'diffuse'), 'never manufacture a diffuse for an orphan ORM');
console.log(JSON.stringify({ result: 'PASS: complete native records, diffuse-based routing, paired maps and native parameters across all five terrain choices', rows, t30DiffuseFamilies: diffuseFamilies }, null, 2));
