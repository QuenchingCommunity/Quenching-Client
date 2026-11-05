import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { parseSkinSections } from '../src/shared/skin-versions';
import { resolveBranchModFile, setBranchModEnabledOnDisk } from '../src/Main/services/branch-mod-toggle';
import { syncUnitSkinBattleMode } from '../src/Main/services/unit-skin-profile';
import { SKIN_CONFIG } from '../src/Renderer/assets/data/skin-config';
import { warbandChoices } from '../src/Renderer/assets/data/skin-panel-catalog';
import { scopedSkin } from '../src/shared/skin-versions';

const fixtureParent = path.resolve('_tmp/skin-experience');
await fs.ensureDir(fixtureParent);
const fixture = await fs.mkdtemp(path.join(fixtureParent, 'quenching-version-skins-'));
const retail = path.join(fixture, '_retail_');
const target = path.join(retail, 'units', 'unitskin.txt');
const before = '[Hamg]\nfile=existing\nfile:hd=keep-hd\nfile:de=keep-de\n[Hpal]\nfile=paladin\n';
await fs.ensureDir(path.dirname(target));
await fs.writeFile(target, before);
const config: any = { war3Path: fixture, customSkins: [{ id: 'legacy', targetId: 'Hamg', config: [] }] };
(globalThis as any).__skinFixture = { config, assets: path.resolve('assets'), target };
const bundle = await build({ stdin: { contents: 'export {versionSkinService} from "./src/Main/services/version-skin-service"; export {customSkinService} from "./src/Main/services/custom-skin-service";', resolveDir: process.cwd(), loader: 'ts' }, platform: 'node', format: 'cjs', packages: 'external', bundle: true, write: false,
  plugins: [{ name: 'fixture-dependencies', setup(build) {
    build.onResolve({ filter: /(?:config-manager|asset-sync|full-package-service|\/skin-service|@jamiephan\/casclib)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
      const prefix = 'const fixture = globalThis.__skinFixture;';
      const contents = args.path.endsWith('config-manager') ? 'export const configManager = {get: k=>fixture.config[k],set:(k,v)=>{fixture.config[k]=v}};'
        : args.path.endsWith('asset-sync') ? 'export const AssetSyncService={getAssetsDir:async()=>fixture.assets};'
        : args.path.endsWith('full-package-service') ? 'export async function assertFullPackageInstalled(){throw new Error("fixture: full package absent")}'
        : args.path.endsWith('/skin-service') ? 'export const skinService={enableSkins:async()=>{}};export const usesFullPackageSkinResource=c=>c.some(v=>v.value.startsWith("cos\\\\premium"));'
        : 'export class Storage {open(){throw new Error("fixture: no CASC")} close(){}}';
      return { contents: prefix + contents };
    });
  } }],
});
const module = { exports: {} as any };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { versionSkinService: service, customSkinService: custom } = module.exports;
try {
  await Promise.all([
    service.apply('sd', [{ unitId: 'Hamg', skinId: 'sd-one', changes: [{ field: 'file', value: 'sd-model' }] }]),
    service.apply('de', [{ unitId: 'Hamg', skinId: 'de-one', changes: [{ field: 'file', value: 'de-model' }] }]),
  ]);
  const content = parseSkinSections(await fs.readFile(target, 'utf8'));
  assert.equal(content.Hamg['file:sd'], undefined);
  assert.equal(content.Hamg['file:de'], 'keep-de');
  assert.equal(content.Hamg['file:hd'], 'keep-hd');
  assert.equal(content.Hpal.file, 'paladin');
  const sdTarget = path.join(retail, 'QMoff', 'skin-profiles', 'v30', 'sd', 'unitskin.txt');
  const deTarget = path.join(retail, 'QMoff', 'skin-profiles', 'v30', 'de', 'unitskin.txt');
  assert.equal(parseSkinSections(await fs.readFile(sdTarget, 'utf8')).Hamg['file:sd'], 'sd-model');
  assert.equal(parseSkinSections(await fs.readFile(deTarget, 'utf8')).Hamg['file:de'], 'de-model');
  const panel = await service.panel('sd');
  assert.equal(panel.selections.sd.Hamg, 'sd-one');
  assert.equal(panel.selections.de.Hamg, 'de-one');
  await service.apply('sd', [{ unitId: 'Hamg', skinId: 'original', changes: [] }]);
  assert.equal(parseSkinSections(await fs.readFile(sdTarget, 'utf8')).Hamg['file:sd'], panel.originals.Hamg.find(c => c.field === 'file').value);
  assert.equal(custom.getAll()[0].artSet, 'hd');
  for (const artSet of ['sd','hd','de']) {
    const skin = await custom.create({ artSet, targetId: 'hfoo', name: '相同名称', category: 'unit', source: 'game-paths', modelPath: 'units/human/Footman/Footman' });
    assert.equal(skin.artSet, artSet);
    assert.equal(skin.config[0].value, 'units/human/Footman/Footman');
    assert.equal((await fs.readdir(path.join(retail, 'cos', 'custom', artSet, 'units', 'hfoo'))).length, 1);
  }
  const deletable = await custom.create({ artSet: 'sd', targetId: 'Hamg', name: '删除测试', category: 'hero', source: 'game-paths', modelPath: 'custom/model' });
  await service.apply('sd', [{ unitId: 'Hamg', skinId: deletable.id, changes: deletable.config }]);
  assert.equal(parseSkinSections(await fs.readFile(sdTarget, 'utf8')).Hamg['file:sd'], 'custom/model');
  const disabledSd = path.join(path.dirname(sdTarget), 'unitskin-dis.txt');
  await fs.rename(sdTarget, disabledSd);
  await custom.remove(deletable.id);
  assert.equal(custom.getAll().some((skin: { id: string }) => skin.id === deletable.id), false);
  assert.equal((await service.panel('sd')).selections.sd.Hamg, 'original');
  assert.equal(parseSkinSections(await fs.readFile(disabledSd, 'utf8')).Hamg['file:sd'], panel.originals.Hamg.find(c => c.field === 'file').value);
  assert.equal(await fs.pathExists(sdTarget), false, 'deleting a skin must not turn disabled skins back on');
  await custom.remove(deletable.id); // already removed
  const importDir = path.join(fixture, 'import-source');
  await fs.outputFile(path.join(importDir, 'model.mdl'), 'Version { FormatVersion 800, }');
  await fs.outputFile(path.join(importDir, 'btn.blp'), 'fixture icon');
  const imported = await custom.create({ artSet: 'sd', targetId: 'Hamg', name: '外部删除测试', category: 'hero', source: 'external',
    modelPath: path.join(importDir, 'model.mdl'), iconPath: path.join(importDir, 'btn.blp'), disabledIconPath: path.join(importDir, 'btn.blp') });
  assert.equal(await fs.pathExists(imported.resourceDir), true);
  const importedArt = imported.config.find((change: any) => change.field === 'Art').value;
  assert.match(importedArt, /^ReplaceableTextures\\CommandButtons\\BTNQCustom_[a-f0-9]{24}\.blp$/);
  const disabledArt = importedArt.replace('CommandButtons\\', 'CommandButtonsDisabled\\DIS');
  assert.equal(await fs.readFile(path.join(retail, importedArt), 'utf8'), 'fixture icon');
  assert.equal(await fs.readFile(path.join(retail, disabledArt), 'utf8'), 'fixture icon');
  const legacyCopy = path.join(imported.resourceDir, 'model.mdl');
  await fs.writeFile(legacyCopy, 'Textures 1 { Bitmap { Image "Textures\\body.blp", } }');
  await fs.outputFile(path.join(imported.resourceDir, 'Textures', 'body.blp'), 'legacy skin texture');
  await service.apply('sd', [{ unitId: 'Hamg', skinId: imported.id, changes: imported.config }]);
  assert.equal(parseSkinSections(await fs.readFile(disabledSd, 'utf8')).Hamg['Art:sd'], importedArt);
  // Simulate a 3.5 import whose DISBTN was copied but never linked. Migrate selected parked copies.
  const savedImport = config.customSkins.find((skin: any) => skin.id === imported.id);
  delete savedImport.iconFiles;
  savedImport.config = savedImport.config.map((change: any) => change.field === 'Art'
    ? { field: 'Art', value: path.relative(retail, path.join(imported.resourceDir, 'btn.blp')) } : change);
  await fs.remove(path.join(retail, disabledArt));
  await custom.repairImportedIcons();
  assert.equal(config.customSkins.find((skin: any) => skin.id === imported.id).config.find((change: any) => change.field === 'Art').value, importedArt);
  assert.equal(await fs.readFile(path.join(retail, disabledArt), 'utf8'), 'fixture icon');
  assert.equal(parseSkinSections(await fs.readFile(disabledSd, 'utf8')).Hamg['Art:sd'], importedArt);
  assert((await fs.readFile(legacyCopy, 'utf8')).includes('Image "cos\\custom\\sd\\heroes\\Hamg\\'),
    'applying an older imported skin repairs the model before writing the skin selection');
  await custom.remove(imported.id);
  assert.equal(await fs.pathExists(imported.resourceDir), false);
  assert.equal(await fs.pathExists(path.join(retail, importedArt)), false);
  assert.equal(await fs.pathExists(path.join(retail, disabledArt)), false);
  assert.equal(await fs.pathExists(path.join(importDir, 'model.mdl')), true, 'deleting an imported skin must preserve the source model');
  assert.equal(await fs.readFile(target, 'utf8'), before, 'deleting a skin must not change other art-set profiles');
  // Icons are optional even for external models. Omission restores this art
  // set's baseline icon, never the previously-selected custom BTN/DISBTN.
  const optionalModel = path.join(importDir, 'optional.mdl');
  const optionalPortrait = path.join(importDir, 'optional_portrait.mdl');
  const manualPortrait = path.join(importDir, 'separate-portrait.mdl');
  await fs.outputFile(optionalModel, 'Version { FormatVersion 800, }');
  await fs.outputFile(optionalPortrait, 'Version { FormatVersion 800, }');
  await fs.outputFile(manualPortrait, '// Explicit portrait, not the automatically detected companion\nVersion { FormatVersion 800, }');
  const iconTargets: Record<string, string> = { sd: disabledSd, hd: target, de: deTarget };
  for (const artSet of ['sd', 'hd', 'de']) {
    const baseInput = { artSet, targetId: 'Npal', category: 'hero', source: 'external', modelPath: optionalModel };
    const withIcons = await custom.create({ ...baseInput, name: `Override ${artSet}`, iconPath: path.join(importDir, 'btn.blp'), disabledIconPath: path.join(importDir, 'btn.blp') });
    await service.apply(artSet, [{ unitId: 'Npal', skinId: withIcons.id, changes: withIcons.config }]);
    const inherited = await custom.create({ ...baseInput, name: `Original icons ${artSet}`, iconPath: ' ', disabledIconPath: '',
      ...(artSet === 'hd' ? { portraitPath: manualPortrait } : {}) });
    assert.equal(inherited.config.some((c: any) => c.field === 'Art'), false);
    assert.equal(inherited.preview, undefined); assert.equal(inherited.iconFiles, undefined);
    assert.deepEqual((await fs.readdir(inherited.resourceDir)).sort(), ['model.mdl', 'model_portrait.mdl']);
    const portrait = inherited.config.find((c: any) => c.field === 'portrait').value;
    assert.equal(inherited.portraitAssociation.source, 'manual');
    assert.equal(await fs.readFile(path.join(retail, portrait), 'utf8'),
      await fs.readFile(artSet === 'hd' ? manualPortrait : optionalPortrait, 'utf8'));
    await service.apply(artSet, [{ unitId: 'Npal', skinId: inherited.id, changes: inherited.config }]);
    const section = parseSkinSections(await fs.readFile(iconTargets[artSet], 'utf8')).Npal;
    const stockArt = (await service.panel(artSet)).originals.Npal.find((c: any) => c.field === 'Art').value;
    assert.equal(section[`Art:${artSet}`], stockArt);
    assert.equal(section[`portrait:${artSet}`], portrait);
    await custom.repairImportedIcons();
    assert.equal(custom.getAll().find((s: any) => s.id === inherited.id).config.some((c: any) => c.field === 'Art'), false);
    await custom.remove(withIcons.id); await custom.remove(inherited.id);
    assert.equal(await fs.pathExists(inherited.resourceDir), false);
    assert.equal(await fs.pathExists(optionalModel), true); assert.equal(await fs.pathExists(manualPortrait), true);
  }
  for (const missing of ['iconPath', 'disabledIconPath']) {
    const incomplete: any = { artSet: 'hd', targetId: 'Npal', category: 'hero', source: 'external', modelPath: optionalModel,
      name: 'Unpaired icons', iconPath: path.join(importDir, 'btn.blp'), disabledIconPath: path.join(importDir, 'btn.blp') };
    delete incomplete[missing];
    await assert.rejects(custom.create(incomplete), /BTN.*DISBTN/);
  }
  await fs.outputFile(path.join(importDir, 'model_portrait.mdl'), 'Textures 1 { Bitmap { Image "face.blp", } }');
  await fs.outputFile(path.join(importDir, 'face.blp'), 'portrait face');
  const offSkin = await custom.create({ artSet: 'hd', targetId: 'Hamg', name: 'MOD off icon migration', category: 'hero', source: 'external',
    modelPath: path.join(importDir, 'model.mdl'), iconPath: path.join(importDir, 'btn.blp'), disabledIconPath: path.join(importDir, 'btn.blp') });
  await service.apply('hd', [{ unitId: 'Hamg', skinId: offSkin.id, changes: offSkin.config }]);
  const offArt = offSkin.config.find((change: any) => change.field === 'Art').value;
  const offDisabledArt = offArt.replace('CommandButtons\\', 'CommandButtonsDisabled\\DIS');
  const offPortrait = offSkin.config.find((change: any) => change.field === 'portrait').value;
  assert.equal(await fs.pathExists(path.join(retail, offPortrait)), true);
  const oldArt = path.relative(retail, path.join(offSkin.resourceDir, 'btn.blp'));
  const offRecord = config.customSkins.find((skin: any) => skin.id === offSkin.id);
  delete offRecord.iconFiles;
  offRecord.config = offRecord.config.map((change: any) => change.field === 'Art' ? { field: 'Art', value: oldArt } : change);
  await fs.writeFile(target, (await fs.readFile(target, 'utf8')).replace(offArt, oldArt));
  await fs.remove(path.join(retail, offDisabledArt));
  await setBranchModEnabledOnDisk(retail, false, { quenchingDir: path.join(fixture, 'empty-assets') });
  await custom.repairImportedModels();
  assert.equal(await fs.pathExists(target), false, 'legacy icon migration must not enable MOD or skins');
  const parkedTable = await resolveBranchModFile(retail, 'units/unitskin.txt');
  assert.equal(parseSkinSections(await fs.readFile(parkedTable, 'utf8')).Hamg['Art:hd'], offArt);
  assert.equal(await fs.pathExists(path.join(retail, offArt)), false);
  assert.equal(await fs.readFile(path.join(retail, 'QMoff', offDisabledArt), 'utf8'), 'fixture icon');
  await service.apply('hd', [{ unitId: 'Hamg', skinId: offSkin.id, changes: offSkin.config }]);
  assert.equal(await fs.pathExists(target), false, 'choosing a skin while the main MOD switch is off only writes its parked table');
  assert.equal(parseSkinSections(await fs.readFile(parkedTable, 'utf8')).Hamg['portrait:hd'], offPortrait);
  await setBranchModEnabledOnDisk(retail, true, { quenchingDir: path.join(fixture, 'empty-assets') });
  assert.equal(parseSkinSections(await fs.readFile(target, 'utf8')).Hamg['Art:hd'], offArt);
  assert.equal(await fs.readFile(path.join(retail, offDisabledArt), 'utf8'), 'fixture icon');
  assert.equal(await fs.pathExists(path.join(retail, offPortrait)), true, 'portrait restores with the branch');
  await custom.remove(offSkin.id);
  assert.equal(await fs.pathExists(path.join(retail, offPortrait)), false, 'deleting a skin deletes its imported portrait');
  assert.equal(parseSkinSections(await fs.readFile(target, 'utf8')).Hamg['portrait:hd'], undefined, 'deletion restores the original automatic portrait');
  // The new 3.0 neutral tavern hero uses the same persistent custom-skin
  // workflow in all three art sets, including deletion/reset isolation.
  const paladinSkins = [];
  for (const artSet of ['sd', 'hd', 'de']) {
    const skin = await custom.create({ artSet, targetId: 'Npal', race: 'neutral', category: 'hero',
      name: 'Forsaken Paladin custom', source: 'game-paths', modelPath: `custom/${artSet}/forsaken-paladin` });
    paladinSkins.push(skin);
    await service.apply(artSet, [{ unitId: 'Npal', skinId: skin.id, changes: skin.config }]);
    assert.equal((await service.panel(artSet)).selections[artSet].Npal, skin.id);
  }
  const paladinFiles: Record<string, string> = { sd: disabledSd, hd: target, de: deTarget };
  for (const artSet of ['sd', 'hd', 'de']) {
    const saved = parseSkinSections(await fs.readFile(paladinFiles[artSet], 'utf8')).Npal;
    assert.equal(saved[`file:${artSet}`], `custom/${artSet}/forsaken-paladin`);
    assert.equal(saved[`unitSound:${artSet}`], 'HeroForsakenPaladin');
  }
  await custom.remove(paladinSkins[0].id);
  const paladinPanel = await service.panel('sd');
  assert.equal(paladinPanel.selections.sd.Npal, 'original');
  assert.equal(paladinPanel.selections.hd.Npal, paladinSkins[1].id);
  assert.equal(paladinPanel.selections.de.Npal, paladinSkins[2].id);
  await custom.remove(paladinSkins[1].id); await custom.remove(paladinSkins[2].id);
  // Simulate stock Samuro's explicit DE association without a real game install.
  const portraitTexture = Buffer.alloc(268); portraitTexture.write('cos/custom/fixture/body.blp', 4);
  const portraitHeader = Buffer.alloc(8); portraitHeader.write('TEXS'); portraitHeader.writeUInt32LE(268, 4);
  await fs.outputFile(path.join(retail, 'units/orc/HeroBladeMaster/HeroBladeMaster_portrait.mdx'), Buffer.concat([Buffer.from('MDLX'), portraitHeader, portraitTexture]));
  await fs.outputFile(path.join(retail, 'cos/custom/fixture/body.blp'), 'portrait texture');
  const siblingOnly = Buffer.alloc(268); siblingOnly.write('face.blp', 4);
  await fs.outputFile(path.join(retail, 'units/orc/Samuro/untrusted_portrait.mdx'), Buffer.concat([Buffer.from('MDLX'), portraitHeader, siblingOnly]));
  await fs.outputFile(path.join(retail, 'units/orc/Samuro/face.blp'), 'sibling is not a game-root texture');
  await assert.rejects(custom.create({ artSet: 'de', targetId: 'Obla', category: 'hero', source: 'game-paths', name: 'Missing root texture',
    modelPath: 'Units/Orc/Samuro/Samuro', portraitPath: 'Units/Orc/Samuro/untrusted_portrait.mdx' }), /face.blp/);
  const samuro = await custom.create({ artSet: 'de', targetId: 'Obla', category: 'hero', source: 'game-paths', name: 'Samuro portrait regression', modelPath: 'Units/Orc/Samuro/Samuro' });
  assert.match(samuro.config.find((c: any) => c.field === 'portrait').value, /HeroBladeMaster_portrait/i);
  await service.apply('de', [{ unitId: 'Obla', skinId: samuro.id, changes: samuro.config }]);
  assert.match(parseSkinSections(await fs.readFile(deTarget, 'utf8')).Obla['portrait:de'], /HeroBladeMaster_portrait/i);
  await custom.remove(samuro.id);
  assert.equal(parseSkinSections(await fs.readFile(deTarget, 'utf8')).Obla['portrait:de'], undefined);
  // Applying/resetting a skin while battle lighting is active keeps the
  // selected model's scale as the reversible source, including special units.
  config.modSettings = { resolvedVersion: 'v301', lighting: 'standard', improveReadability: true };
  await service.apply('hd', [{ unitId: 'hmtt', skinId: 'fixture-battle', changes: [{ field: 'modelScale', value: '1.2' }] }]);
  assert.equal(parseSkinSections(await fs.readFile(target, 'utf8')).hmtt['modelScale:hd'], '1.12');
  await syncUnitSkinBattleMode(retail, 'hd', 'v30', { resolvedVersion: 'v301', improveReadability: false });
  assert.equal(parseSkinSections(await fs.readFile(target, 'utf8')).hmtt['modelScale:hd'], '1.2');
  await service.apply('hd', [{ unitId: 'hmtt', skinId: 'original', changes: [] }]);
  assert.equal(parseSkinSections(await fs.readFile(target, 'utf8')).hmtt['modelScale:hd'], '0.77');
  await service.apply('hd', [{ unitId: 'Hamg', skinId: 'fixture-hero', changes: [{ field: 'modelScale', value: '1.3' }] }]);
  assert.equal(parseSkinSections(await fs.readFile(target, 'utf8')).Hamg['modelScale:hd'], '1.3');
  // Apply every preset through the real service, rather than just checking paths.
  config.modSettings = { resolvedVersion: 'v301', improveReadability: false };
  for (const [race, catalog] of Object.entries(SKIN_CONFIG)) for (const preset of catalog.warbands.slice(1)) {
    const choices = warbandChoices(race, preset.id);
    await service.apply('hd', choices);
    const written = parseSkinSections(await fs.readFile(target, 'utf8'));
    for (const choice of choices) for (const change of scopedSkin(choice.changes, 'hd')) {
      assert.equal(written[choice.unitId][change.field], change.value, `${preset.id}/${choice.unitId}/${change.field} applies`);
    }
  }
  const elfChoices = warbandChoices('hum', 'h_u3');
  assert.equal(elfChoices.length, 8);
  await service.apply('hd', elfChoices);
  const retained = await custom.create({ artSet: 'de', targetId: 'Npal', category: 'hero', source: 'game-paths', name: 'Reinstall persistence', modelPath: 'custom/de/retained' });
  await service.apply('de', [{ unitId: retained.targetId, skinId: retained.id, changes: retained.config }]);
  const retainedExternal = await custom.create({ artSet: 'sd', targetId: 'Hamg', category: 'hero', source: 'external', name: 'External reinstall persistence',
    modelPath: optionalModel, portraitPath: manualPortrait, iconPath: path.join(importDir, 'btn.blp'), disabledIconPath: path.join(importDir, 'btn.blp') });
  await service.apply('sd', [{ unitId: retainedExternal.targetId, skinId: retainedExternal.id, changes: retainedExternal.config }]);
  // A reinstall destroys the previously deployed overrides. Recovery must use
  // persisted IDs/catalog/custom records, not copy the overwritten file back.
  const rootKey = path.resolve(fixture).toLowerCase();
  config.skinSelections[rootKey] = { hd: Object.fromEntries(elfChoices.map(c => [c.unitId, c.skinId])), de: { Npal: retained.id }, sd: { Hamg: retainedExternal.id, hfoo: 'original' } };
  const savedSelections = JSON.stringify(config.skinSelections);
  const unselectedBranch = path.join(fixture, '_ptr_/units/unitskin.txt');
  await fs.outputFile(unselectedBranch, 'other branch: untouched');
  await fs.writeFile(target, '[hfoo]\nfile=package-default\nfile:hd:melee,V0=package-masked\n');
  await fs.remove(deTarget); // inactive profiles may have been removed by a reinstall
  await fs.writeFile(disabledSd, '[Hamg]\nfile=package-default\n');
  assert.deepEqual(await service.restoreSelections(), []);
  const recovered = parseSkinSections(await fs.readFile(target, 'utf8'));
  for (const choice of elfChoices) for (const change of scopedSkin(choice.changes, 'hd')) {
    assert.equal(recovered[choice.unitId][change.field], change.value, `restore ${choice.unitId}/${change.field}`);
  }
  assert.equal(recovered.hfoo['file:hd:melee,V0'], undefined, 'no package qualifier can mask the restored skin');
  assert.equal(parseSkinSections(await fs.readFile(deTarget, 'utf8')).Npal['file:de'], 'custom/de/retained');
  const recoveredExternal = parseSkinSections(await fs.readFile(disabledSd, 'utf8')).Hamg;
  for (const field of ['file', 'Art', 'portrait']) {
    assert.equal(recoveredExternal[`${field}:sd`], retainedExternal.config.find((c: any) => c.field === field).value, `external ${field} association survives reinstall`);
  }
  assert.equal(await fs.pathExists(sdTarget), false, 'restoration keeps the disabled SD profile parked');
  assert.equal(await fs.readFile(unselectedBranch, 'utf8'), 'other branch: untouched');
  assert.equal(JSON.stringify(config.skinSelections), savedSelections);
  await fs.move(target, path.join(retail, 'units/unitskin-dis.txt'));
  assert.deepEqual(await service.restoreSelections(), []);
  assert.equal(await fs.pathExists(target), false, 'restoring a disabled skin must keep it disabled');
  await fs.move(path.join(retail, 'units/unitskin-dis.txt'), target);
  config.customSkins.push({ id: 'damaged-import', targetId: 'Obla', artSet: 'de', source: 'game-paths', config: [
    { field: 'file', value: 'missing/model' }, { field: 'portrait', value: 'missing/portrait' },
  ] });
  config.skinSelections[rootKey].de.Obla = 'damaged-import';
  await fs.writeFile(target, '[hfoo]\nfile=package-default\n');
  const partialRestore = await service.restoreSelections();
  assert.equal(partialRestore.length, 1);
  assert.match(partialRestore[0], /de\/Obla/);
  assert.equal(config.skinSelections[rootKey].de.Obla, 'damaged-import', 'broken selections remain available for repair');
  assert.equal(parseSkinSections(await fs.readFile(target, 'utf8')).hfoo['file:hd'], elfChoices.find(c => c.unitId === 'hfoo')!.changes.find(c => c.field === 'file')!.value,
    'one missing portrait does not block recovery of other choices');
  const savedAfterDelete = JSON.stringify(config.skinSelections);
  const original30 = await service.panel('hd');
  assert.equal(original30.originals.Hamg.find((field: { field: string }) => field.field === 'modelScale')?.value, '1');
  await fs.outputJson(path.join(retail, '.quenching', 'unit-skin-profile.json'),
    { schema: 1, profile: 'hd', era: 'v20', baseline: 2 });
  const original20 = await service.panel('hd');
  assert.equal(original20.originals.Hamg.find((field: { field: string }) => field.field === 'modelScale')?.value, '1.05');
  config.war3Path = path.join(fixture, 'another-install');
  assert.deepEqual((await service.panel('hd')).selections, {});
  assert.equal(JSON.stringify(config.skinSelections), savedAfterDelete);
  console.log('PASS: per-profile skin writes, concurrent version isolation, persistence, reset, legacy migration, custom version folders, installation isolation');
} finally {
  // Only remove the exact temporary fixture allocated above, never a game directory.
  assert(path.dirname(fixture) === fixtureParent && path.basename(fixture).startsWith('quenching-version-skins-'));
  await fs.remove(fixture);
  delete (globalThis as any).__skinFixture;
}
