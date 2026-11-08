import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'fs-extra';
import zlib from 'node:zlib';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const fixture = { enabled: true, channel: 'retail' };
(globalThis as any).__branchStartupFixture = fixture;
const compiled = await build({
  stdin: { contents: 'export * from "./src/Main/services/branch-mod-toggle";export * from "./src/Main/services/vision-modules";export * from "./src/Main/services/third-party-resources";', resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'branch-startup-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^\.\/(game-channel|full-package-service|asset-sync)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('asset-sync')
      ? 'export const AssetSyncService={getAssetsDir:async()=>{throw Error("Expected explicit fixture assets");}};'
      : args.path.endsWith('full-package-service')
      ? 'export const isFullPackageInstalled=async()=>false;'
      : 'const f=globalThis.__branchStartupFixture;export const getSelectedGameFolder=()=>f.channel==="ptr"?"_ptr_":"_retail_";export const getSelectedGameChannel=()=>f.channel;export const getChannelModEnabled=()=>f.enabled;' }));
  } }],
});
const loaded = { exports: {} as any };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { recoverBranchModToggleAtStartup, setBranchModEnabledOnDisk, setVisionModule, getVisionModules,
  importThirdPartySource, setThirdPartyEnabled, resolveBranchModFile } = loaded.exports;
const parent = path.resolve('_tmp/branch-startup-recovery-20261107');
await fs.ensureDir(parent);
const root = await fs.mkdtemp(path.join(parent, 'test-'));
try {
  const assets = path.join(root, 'assets', 'quenching');
  await fs.ensureDir(assets);
  const options = { quenchingDir: assets };
  const prepare = async (name: string, folder = '_retail_') => {
    const game = path.join(root, name), branch = path.join(game, folder), source = path.join(root, name + '-source');
    const originals = {
      'units/unitskin.txt': 'QM table', 'units/hero.mdx': 'QM model',
      'doodads/our.mdx': 'QM doodad', 'replaceabletextures/our.dds': 'QM texture',
      'units/destructableskin.txt': 'QM trees', 'terrainart/terrain.slk': 'QM terrain',
      'environment/foliage/our.dds': 'QM foliage', 'environment/dnc/unit.mdx': 'QM light',
      'PostProcessingConfig.txt': '[Tonemap]\nEnabled=1', 'NELonstar/custom.txt': 'player-owned',
    };
    for (const [file, content] of Object.entries(originals)) await fs.outputFile(path.join(branch, file), content);
    for (const [file, content] of Object.entries({
      'units/hero.mdx': 'VM model', 'doodads/vm.mdx': 'VM doodad',
      'terrainart/terrain.slk': 'VM terrain', 'environment/foliage/vm.dds': 'VM foliage',
      'ui/test.fdf': 'VM UI',
    })) await fs.outputFile(path.join(source, file), content);
    await fs.outputFile(path.join(branch, '_patch/keep.que'), '-v3.5-\n');
    await fs.outputFile(path.join(branch, '_patch/qmf-3.5.files.json.gz'), zlib.gzipSync(JSON.stringify({
      schema: 1, product: 'quenching-mod', version: '3.5',
      files: Object.keys(originals).filter(file => file !== 'NELonstar/custom.txt' && file !== 'PostProcessingConfig.txt').map(file => ({ path: file })),
    })));
    return { game, branch, source };
  };
  const activate = async (game: string, source: string) => {
    fixture.enabled = true;
    for (const module of ['visionUnits', 'visionDecorations', 'visionTerrain', 'visionMisc']) await setVisionModule(game, source, module, true);
  };

  // Manual off restores originals before parking them; no Vision file is parked as QM.
  const manual = await prepare('manual');
  await activate(manual.game, manual.source);
  assert.equal(await recoverBranchModToggleAtStartup(manual.branch, true, options), null);
  assert.equal(await fs.readFile(path.join(manual.branch, 'units/hero.mdx'), 'utf8'), 'VM model');
  await setBranchModEnabledOnDisk(manual.branch, false, options);
  assert(Object.values(await getVisionModules(manual.game)).every(value => !value));
  assert.equal(await fs.readFile(path.join(manual.branch, 'QMoff/units/unitskin.txt'), 'utf8'), 'QM table');
  assert.equal(await fs.readFile(path.join(manual.branch, 'QMoff/units/hero.mdx'), 'utf8'), 'QM model');
  assert.equal(await fs.readFile(path.join(manual.branch, 'QMoff/terrainart/terrain.slk'), 'utf8'), 'QM terrain');
  assert.equal(await fs.pathExists(path.join(manual.branch, 'doodads/vm.mdx')), false);
  assert.equal(await fs.pathExists(path.join(manual.branch, 'environment/foliage/vm.dds')), false);
  assert.equal(await fs.pathExists(path.join(manual.branch, 'ui/test.fdf')), false);
  assert.equal(await fs.readFile(path.join(manual.branch, 'NELonstar/custom.txt'), 'utf8'), 'player-owned');
  // Enabling QM again must not silently re-enable Vision.
  await setBranchModEnabledOnDisk(manual.branch, true, options);
  assert.equal(await fs.readFile(path.join(manual.branch, 'units/hero.mdx'), 'utf8'), 'QM model');
  assert(Object.values(await getVisionModules(manual.game)).every(value => !value));

  // Off config without a journal must be physically repaired.
  const legacy = await prepare('legacy');
  await activate(legacy.game, legacy.source); fixture.enabled = false;
  assert.equal(await recoverBranchModToggleAtStartup(legacy.branch, false, options), null);
  assert.equal(await fs.readFile(path.join(legacy.branch, 'QMoff/units/unitskin.txt'), 'utf8'), 'QM table');
  assert.equal(await fs.pathExists(path.join(legacy.branch, 'ui/test.fdf')), false);
  await assert.rejects(setVisionModule(legacy.game, legacy.source, 'visionUnits', true), /请先启用/);

  // Completed off + VM on nonselected PTR must never mutate Retail.
  fixture.channel = 'ptr';
  const ptr = await prepare('ptr', '_ptr_'); await activate(ptr.game, ptr.source);
  await fs.outputJson(path.join(ptr.branch, '.quenching/branch-toggle.json'), { schema: 1, phase: 'disabled', moves: [] });
  await fs.outputFile(path.join(ptr.game, '_retail_/units/unitskin.txt'), 'untouched Retail');
  fixture.channel = 'retail'; fixture.enabled = false;
  assert.equal(await recoverBranchModToggleAtStartup(ptr.branch, false, options), false);
  assert.deepEqual(await fs.readJson(path.join(ptr.branch, '.quenching-vision-modules.json')), {});
  assert.equal(await fs.readFile(await resolveBranchModFile(ptr.branch, 'units/unitskin.txt'), 'utf8'), 'QM table');
  assert.equal(await fs.pathExists(path.join(ptr.branch, 'units/unitskin.txt')), false);
  assert.equal(await fs.readFile(path.join(ptr.game, '_retail_/units/unitskin.txt'), 'utf8'), 'untouched Retail');

  // Roll back an interrupted move first, then honour the saved off preference.
  const pending = await prepare('pending'); await activate(pending.game, pending.source);
  await fs.ensureDir(path.join(pending.branch, 'QMoff/units'));
  await fs.rename(path.join(pending.branch, 'units/unitskin.txt'), path.join(pending.branch, 'QMoff/units/unitskin.txt'));
  await fs.outputJson(path.join(pending.branch, '.quenching/branch-toggle.json'), {
    schema: 1, phase: 'disabling', moves: [{ active: 'units/unitskin.txt', parked: 'QMoff/units/unitskin.txt' }],
  });
  assert.equal(await recoverBranchModToggleAtStartup(pending.branch, false, options), false);
  assert.equal(await fs.readFile(path.join(pending.branch, 'QMoff/units/unitskin.txt'), 'utf8'), 'QM table');
  assert.equal(await fs.pathExists(path.join(pending.branch, 'units/unitskin.txt')), false);
  assert.deepEqual(await fs.readJson(path.join(pending.branch, '.quenching-vision-modules.json')), {});

  // Missing originals keep the current module intact and stop the MOD move.
  const broken = await prepare('broken'); await activate(broken.game, broken.source);
  const visionFile = path.join(broken.branch, '.quenching-vision-modules.json');
  const state = await fs.readJson(visionFile);
  await fs.remove(path.join(broken.branch, '.quenching-vision-backups', state.visionTerrain.backup, 'terrainart'));
  await assert.rejects(recoverBranchModToggleAtStartup(broken.branch, false, options), /原文件备份缺失/);
  assert.equal(await fs.readFile(path.join(broken.branch, 'terrainart/terrain.slk'), 'utf8'), 'VM terrain');
  assert.equal(await fs.readFile(path.join(broken.branch, 'units/unitskin.txt'), 'utf8'), 'QM table');
  assert.equal(await fs.pathExists(path.join(broken.branch, '.quenching/branch-toggle.json')), false);
  assert((await fs.readJson(visionFile)).visionTerrain);
  await fs.outputFile(path.join(broken.branch, '.quenching/branch-toggle.json'), '{invalid');
  await assert.rejects(recoverBranchModToggleAtStartup(broken.branch, false, options), SyntaxError);
  assert.equal(await fs.readFile(path.join(broken.branch, '.quenching/branch-toggle.json'), 'utf8'), '{invalid');

  // Old resource slots follow the same sequence and retain their staged import.
  const generic = await prepare('generic'); fixture.enabled = true;
  await importThirdPartySource(generic.game, 1, { kind: 'directory', path: generic.source });
  await setThirdPartyEnabled(generic.game, 1, true);
  fixture.enabled = false;
  await recoverBranchModToggleAtStartup(generic.branch, false, options);
  const slots = await fs.readJson(path.join(generic.branch, '_QMThirdParty.json'));
  assert.equal(slots.slots[0].enabled, false); assert.equal(slots.slots[0].imported, true);
  assert.equal(await fs.readFile(path.join(generic.branch, 'QMoff/units/unitskin.txt'), 'utf8'), 'QM table');
  assert.equal(await fs.pathExists(path.join(generic.branch, 'ui/test.fdf')), false);
  await assert.rejects(setThirdPartyEnabled(generic.game, 1, true), /请先启用/);

  // Generic-slot originals are checked before withdrawing active files too.
  const missingSlot = await prepare('missing-slot'); fixture.enabled = true;
  await importThirdPartySource(missingSlot.game, 1, { kind: 'directory', path: missingSlot.source });
  await setThirdPartyEnabled(missingSlot.game, 1, true);
  await fs.remove(path.join(missingSlot.branch, 'QMoff/third-party/units/units'));
  await assert.rejects(recoverBranchModToggleAtStartup(missingSlot.branch, false, options), /原文件备份缺失/);
  assert.equal(await fs.readFile(path.join(missingSlot.branch, 'units/hero.mdx'), 'utf8'), 'VM model');
  assert.equal((await fs.readJson(path.join(missingSlot.branch, '_QMThirdParty.json'))).slots[0].enabled, true);
  assert.equal(await fs.pathExists(path.join(missingSlot.branch, '.quenching/branch-toggle.json')), false);

  fixture.channel = 'ptr'; fixture.enabled = true;
  const ptrSlot = await prepare('ptr-slot', '_ptr_');
  await fs.outputFile(path.join(ptrSlot.game, '_retail_/units/unitskin.txt'), 'untouched slot Retail');
  await importThirdPartySource(ptrSlot.game, 1, { kind: 'directory', path: ptrSlot.source });
  await setThirdPartyEnabled(ptrSlot.game, 1, true);
  fixture.channel = 'retail'; fixture.enabled = false;
  await recoverBranchModToggleAtStartup(ptrSlot.branch, false, options);
  assert.equal((await fs.readJson(path.join(ptrSlot.branch, '_QMThirdParty.json'))).slots[0].enabled, false);
  assert.equal(await fs.readFile(path.join(ptrSlot.branch, 'QMoff/units/unitskin.txt'), 'utf8'), 'QM table');
  assert.equal(await fs.readFile(path.join(ptrSlot.game, '_retail_/units/unitskin.txt'), 'utf8'), 'untouched slot Retail');

  console.log('PASS: restore Vision then park QM; legacy/completed off repair; explicit PTR; missing/invalid record protection; generic slot repair and enable guards; player folder preservation');
} finally {
  delete (globalThis as any).__branchStartupFixture;
  await fs.remove(root);
}
