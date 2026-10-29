import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readSlkTable } from './terrain-slk-utils.mjs';

const assetDir = path.resolve('assets/unpacked/tile');
const packageRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;

// These SLKs contain non-UTF-8 Excel metadata. Reading as latin1 also keeps
// the bytes outside the cell records intact for comparison with packaged data.
function readSlk(file) {
  const rows = new Map();
  let x = 0;
  let y = 0;
  for (const line of fs.readFileSync(file, 'latin1').split(/\r?\n/)) {
    if (!/^[CF];/.test(line)) continue;
    const row = line.match(/(?:^|;)Y(\d+)/);
    const column = line.match(/(?:^|;)X(\d+)/);
    if (row) y = Number(row[1]);
    if (column) x = Number(column[1]);
    if (!line.startsWith('C;')) continue;
    const value = line.match(/(?:^|;)K(?:"([^"]*)"|([^;]*))/);
    if (!value) continue;
    if (!rows.has(y)) rows.set(y, new Map());
    rows.get(y).set(x, value[1] ?? value[2]);
  }
  return [...rows.entries()].filter(([row]) => row >= 2).map(([, cells]) => cells);
}

const cliffs = readSlk(path.join(assetDir, 'clifftypes20.slk'));
const tiles = readSlk(path.join(assetDir, 'terrain20.slk'));
const cliffsById = new Map(cliffs.map((row) => [row.get(1), row]));
const tilesById = new Map(tiles.map((row) => [row.get(1), row]));
const packageCliffsById = packageRoot
  ? new Map(readSlk(path.join(packageRoot, 'terrainart', '_setting', 'clifftypes.slk')).map((row) => [row.get(1), row]))
  : null;
const packageTilesById = packageRoot
  ? new Map(readSlk(path.join(packageRoot, 'terrainart', '_setting', 'terrain.slk')).map((row) => [row.get(1), row]))
  : null;

const expected = [
  ['CDdi', 'D', 'Ddrt', 'dungeon', 'Cave_Dirt', 'Cliff0'],
  ['CDsq', 'D', 'Dsqd', 'dungeon', 'Cave_SquareTiles', 'Cliff1'],
  ['CGdi', 'G', 'Gdrt', 'dungeon2', 'GDirt', 'Cliff0'],
  ['CGsq', 'G', 'Gsqd', 'dungeon2', 'GSquareTiles', 'Cliff1'],
  ['COdi', 'O', 'Odrt', 'outland', 'Outland_Dirt', 'Cliff0'],
  ['COrd', 'O', 'Oaby', 'outland', 'Outland_Abyss', 'Cliff1'],
  ['CKdi', 'K', 'Kdrt', 'blackcitadel', 'Citadel_Dirt', 'Cliff0'],
  ['CKdt', 'K', 'Kdkt', 'blackcitadel', 'Citadel_DarkTiles', 'Cliff1'],
];

for (const [id, group, groundTile, tileFolder, tileFile, cliffFile] of expected) {
  const cliff = cliffsById.get(id);
  const tile = tilesById.get(groundTile);
  assert.ok(cliff && tile, `${id}: cliff or ground tile is missing`);
  assert.equal(cliff.get(7), groundTile, `${id}: wrong groundTile`);
  const nativeFamily = group === 'O' || group === 'K';
  const nativeFolder = group === 'O' ? 'Outland' : 'BlackCitadel';
  const nativeCliff = `${group === 'O' ? 'Outland' : 'Citadel'}_${cliffFile}`;
  assert.equal(cliff.get(4), nativeFamily ? `TerrainArt\\${nativeFolder}` : `ReplaceableTextures\\cliff\\c20\\Cliff${group}`, `${id}: wrong texDir`);
  assert.equal(cliff.get(5), nativeFamily ? nativeCliff : cliffFile, `${id}: wrong texFile`);
  assert.equal(tile.get(3).toLowerCase(), nativeFamily ? `terrainart\\${tileFolder}` : `t20\\${tileFolder}`, `${id}: wrong terrain dir`);
  assert.equal(tile.get(4), tileFile, `${id}: wrong terrain file`);

  if (packageRoot) {
    assert.equal(packageCliffsById.get(id)?.get(4), cliff.get(4), `${id}: package cliff SLK differs from client assets`);
    assert.equal(packageTilesById.get(groundTile)?.get(3).toLowerCase(), tile.get(3).toLowerCase(), `${id}: package terrain SLK differs from client assets`);
    if (nativeFamily) continue; // Native texture paths resolve from the game's CASC.
    const cliffDir = path.join(packageRoot, 'replaceabletextures', 'cliff', 'c20', `Cliff${group}`);
    for (const suffix of ['diffuse', 'normal', 'orm']) {
      assert.ok(fs.existsSync(path.join(cliffDir, `${cliffFile.toLowerCase()}_${suffix}.dds`)), `${id}: missing ${suffix} cliff texture`);
    }
    assert.ok(fs.existsSync(path.join(packageRoot, 't20', tileFolder, `${tileFile.toLowerCase()}_diffuse.dds`)), `${id}: missing ground texture`);
  }
}

// Reserve both families for the native game in every pre-DE terrain style.
// SmallBricks also stays native; no ground or cliff override in either family.
for (const era of ['00', '16', '18', '20']) {
  const terrain = readSlkTable(fs.readFileSync(path.join(assetDir, `terrain${era}.slk`), 'latin1'));
  const cliffTable = readSlkTable(fs.readFileSync(path.join(assetDir, `clifftypes${era}.slk`), 'latin1'));
  for (const [folder, prefix, cliffIds, grounds] of [
    ['Outland', 'Outland', ['COdi', 'COrd'], ['Odrt', 'Oaby']],
    ['BlackCitadel', 'Citadel', ['CKdi', 'CKdt'], ['Kdrt', 'Kdkt']],
  ]) {
    const family = [...terrain.rows].filter(([, row]) => row.get('file')?.startsWith(`${prefix}_`));
    assert.equal(family.length, 10, `T${era}: ${folder} must include eight ground tiles and two cliff-top aliases`);
    for (const [id, row] of family) {
      assert.equal(row.get('dir'), `TerrainArt\\${folder}`, `T${era}: ${id} must preserve the native route`);
    }
    for (const [index, id] of cliffIds.entries()) {
      const row = cliffTable.rows.get(id);
      assert.equal(row?.get('texDir'), `TerrainArt\\${folder}`, `T${era}: ${id} cliff directory`);
      assert.equal(row.get('texFile'), `${prefix}_Cliff${index}`, `T${era}: ${id} cliff file`);
      assert.equal(row.get('groundTile'), grounds[index], `T${era}: ${id} cliff ground`);
      assert.equal(row.get('overrideTexture'), `ReplaceableTextures\\Cliff\\Cliff${index}`, `T${era}: ${id} native overrideTexture`);
      assert.notEqual(row.get('groundTile'), 'Ksmb', 'SmallBricks must not replace a cliff ground tile');
      assert.notEqual(row.get('upperTile'), 'Ksmb', 'SmallBricks must not replace a cliff upper tile');
    }
  }
}

assert.ok(!cliffs.some((row) => /^ReplaceableTextures\\Cliff$/i.test(row.get(4) ?? '')), 'T20 still has a generic cliff texDir');
assert.equal(tilesById.get('Vrck')?.get(3).toLowerCase(), 't20\\village', 'Vrck should use the packaged T20 texture');
if (packageRoot) assert.equal(packageTilesById.get('Vrck')?.get(3).toLowerCase(), 't20\\village', 'Vrck package terrain dir differs');
console.log(`T20 cliff/terrain mapping passed: ${expected.length} cliffs; T00/T16/T18/T20 entirely native Outland/BlackCitadel routes${packageRoot ? '; package textures' : ''}`);
