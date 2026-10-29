/** Read-only regression against actual CASC, optional QMF tree and old backup. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSlkTable } from './terrain-slk-utils.mjs';

const { Storage } = createRequire(import.meta.url)('@jamiephan/casclib');
const gameRoot = process.argv[2];
const fullRoot = process.argv[3];
const backup = process.argv[4];
assert.ok(gameRoot, 'Pass a read-only Warcraft CASC installation');
const assets = path.resolve('assets/unpacked/tile');
const native = {};
const storage = new Storage();
try {
    storage.open(`${gameRoot}*w3`);
    for (const type of ['clifftypes', 'terrain', 'water']) {
        const file = storage.openFile(`war3.w3mod:terrainart\\${type}.slk`);
        try { native[type] = readSlkTable(file.readAll().toString('latin1')); }
        finally { file.close(); }
    }
} finally { storage.close(); }

for (const type of ['clifftypes', 'terrain']) {
    const base = native[type];
    const managed = type === 'terrain' ? ['dir'] : ['texDir', 'texFile'];
    for (const era of ['00', '16', '18', '20']) {
        const file = `${type}${era}.slk`;
        const table = readSlkTable(fs.readFileSync(path.join(assets, file), 'latin1'));
        const old = backup ? readSlkTable(fs.readFileSync(path.join(backup, 'client', file), 'latin1')) : null;
        assert.deepEqual([...table.headers], [...base.headers], `${file}: native columns were lost or shifted`);
        assert.deepEqual([...table.rows.keys()], [...base.rows.keys()], `${file}: native IDs were lost or reordered`);
        for (const [id, row] of base.rows) {
            const previous = old?.rows.get(id);
            const family = previous && (type === 'terrain' ? `${previous.get('dir')}/${previous.get('file')}` : `${previous.get('texDir')}/${previous.get('texFile')}`).replace(/\\/g, '/');
            const noCustomDiffuse = fullRoot && family && !/^terrainart\//i.test(family) &&
                !['dds', 'tif'].some(ext => fs.existsSync(path.join(fullRoot, `${family}_diffuse.${ext}`)));
            for (const [field, value] of row) {
                // Existing MOD paths stay exactly as before; previously absent
                // campaign records keep their native paths and all parameters.
                const expected = managed.includes(field) && old?.rows.has(id) && !noCustomDiffuse
                    ? old.rows.get(id).get(field) : value;
                if (managed.includes(field) && !old) continue;
                assert.equal(table.rows.get(id).get(field), expected, `${file}: ${id}.${field}`);
            }
        }
    }
}
const tiles = readSlkTable(fs.readFileSync(path.join(assets, 'terrain20.slk'), 'latin1'));
const cliffs = readSlkTable(fs.readFileSync(path.join(assets, 'clifftypes20.slk'), 'latin1'));
for (const [id, cliff] of cliffs.rows) {
    assert.ok(tiles.rows.has(cliff.get('groundTile')), `${id}: cliff ground tile is undefined`);
    assert.equal(cliff.get('overrideTexture'), native.clifftypes.rows.get(id).get('overrideTexture'));
}

for (const file of ['water.slk', 'water-trans.slk']) {
    const table = readSlkTable(fs.readFileSync(path.join(assets, file), 'latin1'));
    assert.deepEqual([...table.headers], [...native.water.headers], `${file}: native water columns changed`);
    assert.deepEqual([...table.rows.keys()], [...native.water.rows.keys()], `${file}: native water IDs missing`);
    for (const [id, row] of native.water.rows) for (const [field, value] of row) {
        const rgb = /^mm(?:Red|Green|Blue)$|^[SD](?:min|max)_[RGB]$/.test(field);
        assert.equal(table.rows.get(id).get(field), rgb ? '0' : value, `${file}: ${id}.${field}`);
    }
}

if (fullRoot) {
    const mappings = [
        ['terrainart/terrain.slk', 'terrain20.slk'],
        ['terrainart/clifftypes.slk', 'clifftypes20.slk'],
        ['terrainart/_setting/terrain.slk', 'terrain20.slk'],
        ['terrainart/_setting/clifftypes.slk', 'clifftypes20.slk'],
        ['terrainart/_setting/water.slk', 'water-trans.slk'],
        ...['00', '16', '18'].map(era => [`t${era}/clifftypes.slk`, `clifftypes${era}.slk`]),
        ...['16', '18'].flatMap(era => [
            [`t${era}/terrain-que/terrain.slk`, `terrain${era}.slk`],
            [`t${era}/terrain-que/clifftypes.slk`, `clifftypes${era}.slk`],
            [`t${era}/terrain-que/water.slk`, 'water-trans.slk'],
        ]),
    ];
    for (const [relative, template] of mappings) {
        const target = path.join(fullRoot, relative);
        if (fs.existsSync(target)) assert.ok(fs.readFileSync(target).equals(fs.readFileSync(path.join(assets, template))), `${relative}: package/client differ`);
    }
    assert.equal(fs.existsSync(path.join(fullRoot, 'terrainart', 'water.slk')), false, 'Full package must retain default active water');
}
console.log(`PASS: native IDs/columns, existing MOD paths, cliff ground references, RGB-only transparent water and package copies (${native.clifftypes.rows.size}/${native.terrain.rows.size}/${native.water.rows.size} records)`);
