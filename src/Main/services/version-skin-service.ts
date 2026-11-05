import { getSelectedGameFolder } from './game-channel';
import fs from 'fs-extra';
import path from 'path';
import { Storage } from '@jamiephan/casclib';
import { openGameCascStorage } from './casc-storage';
import { configManager } from './config-manager';
import { skinService, usesFullPackageSkinResource } from './skin-service';
import { assertFullPackageInstalled } from './full-package-service';
import { AssetSyncService } from './asset-sync';
import { assertArtSet, originalSkin, parseSkinSections, writeVersionSkins, SkinArtSet, SkinSections, SkinSelections, VersionSkinChoice } from '../../shared/skin-versions';
import { activeSkinEra, activeSkinProfile, storedSkinPath, unitSkinTemplate } from './unit-skin-profile';
import { repairImportedModelTextures } from './custom-model-textures';
import { isBranchModDisabled, prepareBranchModFileWrite, resolveBranchModFile } from './branch-mod-toggle';
import { ModelResourceService, resourceCandidates } from './model-resource-service';
import { associatePortrait } from './skin-portrait';
import { applyBattleUnitScales, battleUnitScalesEnabled } from '../../shared/battle-unit-scale';
import { savedSkinChoices } from '../../Renderer/assets/data/skin-panel-catalog';

class VersionSkinService {
  private queue: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, SkinSections>();
  private async baseline(root: string, artSet: SkinArtSet) {
    const retail = path.join(root, getSelectedGameFolder());
    const era = await activeSkinEra(await fs.pathExists(retail) ? retail : root,
      configManager.get('modSettings')?.resolvedVersion);
    const cacheKey = `${path.resolve(root).toLowerCase()}:${getSelectedGameFolder()}:${era}`;
    const cached = this.cache.get(`${cacheKey}:casc`) || this.cache.get(`${cacheKey}:${artSet}`);
    if (cached) return cached;
    let text: string;
    let fromCasc = false;
    const storage = new Storage();
    let releasePath: (() => void) | undefined;
    try {
      releasePath = (await openGameCascStorage(storage, root)).release;
      const file = storage.openFile('war3.w3mod:units\\unitskin.txt');
      try { text = file.readAll().toString('utf8'); fromCasc = true; } finally { file.close(); }
    } catch {
      const assets = await AssetSyncService.getAssetsDir(["skin"]);
      if (!assets) throw new Error('无法读取游戏原版皮肤配置');
      text = await fs.readFile(unitSkinTemplate(path.join(assets, 'quenching'), artSet, era), 'utf8');
    } finally { try { storage.close(); } catch {} releasePath?.(); }
    const sections = parseSkinSections(text);
    this.cache.set(fromCasc ? `${cacheKey}:casc` : `${cacheKey}:${artSet}`, sections);
    return sections;
  }
  private root() {
    const root = configManager.get('war3Path');
    if (!root) throw new Error('请先配置魔兽争霸安装目录');
    return root;
  }
  private key(root: string) { return path.resolve(root).toLowerCase(); }
  async panel(artSet: SkinArtSet) {
    assertArtSet(artSet);
    const root = this.root();
    const sections = await this.baseline(root, artSet);
    const selections = (configManager.get('skinSelections') || {})[this.key(root)] || {};
    return { selections, originals: Object.fromEntries(Object.entries(sections).map(([id, section]) => [id, originalSkin(section, artSet)])) };
  }
  async portrait(artSet: SkinArtSet, targetId: string, model: string, explicit?: string) {
    assertArtSet(artSet);
    const root = this.root(), baseline = await this.baseline(root, artSet);
    const resources = new ModelResourceService();
    try {
      const branch = await fs.pathExists(path.join(root, getSelectedGameFolder())) ? path.join(root, getSelectedGameFolder()) : root;
      const deployed = async (name: string) => {
        if (!/^cos[\\/]custom[\\/]/i.test(name)) return name;
        resourceCandidates({ path: name, artSet }); // Validate before resolving a parked path.
        // Preserve the actual extension. Choosing the preferred .mdx candidate
        // here would lose an imported .mdl file (including its off-journal entry).
        return resolveBranchModFile(branch, name.replace(/\\/g, '/'));
      };
      return await associatePortrait(baseline, targetId, artSet, model, {
        read: async name => resources.read({ path: await deployed(name), artSet }, root),
        // Game texture paths are root-relative. Do not let the preview reader's
        // external sibling/basename search hide a missing in-game dependency.
        exists: async (name, basePath) => resources.exists({ path: await deployed(name),
          basePath: /^casc:\/\//i.test(basePath) ? basePath : undefined, artSet }, root),
      }, explicit);
    } finally { resources.close(); }
  }
  /** Reset a removed custom skin in existing copies without enabling disabled skins. */
  resetCustomSkin(skinId: string): Promise<void> {
    return this.refreshCustomSkin(skinId);
  }
  /** Recover selected skins from persisted IDs after a package replaces unitskin.
   * Never enable disabled skins or write into the other game branch. */
  async restoreSelections(root = this.root()): Promise<string[]> {
    if (this.key(root) !== this.key(this.root())) throw new Error('游戏目录已切换，请重试');
    const { customSkinService } = await import('./custom-skin-service');
    await customSkinService.repairImportedModels();
    const operation = this.queue.then(async () => {
      if (this.key(root) !== this.key(this.root())) throw new Error('游戏目录已切换，请重试');
      const selections = (configManager.get('skinSelections') || {})[this.key(root)] || {};
      const retail = await fs.pathExists(path.join(root, getSelectedGameFolder())) ? path.join(root, getSelectedGameFolder()) : root;
      const active = await activeSkinProfile(retail) || 'hd';
      const era = await activeSkinEra(retail, configManager.get('modSettings')?.resolvedVersion);
      const activeFile = await resolveBranchModFile(retail, 'units/unitskin.txt');
      const enabled = await fs.pathExists(activeFile);
      const warnings: string[] = [];
      for (const artSet of ['sd', 'hd', 'de'] as const) {
        const resolved = savedSkinChoices(artSet, selections[artSet] || {}, customSkinService.getAll());
        warnings.push(...resolved.missing.map(id => `找不到已保存的皮肤：${id}`));
        if (!resolved.choices.length) continue;
        const baseline = await this.baseline(root, artSet);
        const choices = resolved.choices.filter(choice => {
          if (baseline[choice.unitId]) return true;
          warnings.push(`当前版本没有单位：${choice.unitId}`); return false;
        });
        if (!choices.length) continue;
        for (const choice of [...choices]) {
          try {
            writeVersionSkins('', baseline, artSet, [choice]);
            if (choice.skinId === 'original') continue;
            const model = choice.changes.find(c => c.field === `file:${artSet}`)?.value || choice.changes.find(c => c.field === 'file')?.value;
            if (!model) continue;
            const explicit = choice.changes.find(c => c.field === `portrait:${artSet}`)?.value || choice.changes.find(c => c.field === 'portrait')?.value;
            const portrait = await this.portrait(artSet, choice.unitId, model, explicit);
            if (portrait.path) choice.changes = [...choice.changes.filter(c => !['portrait', `portrait:${artSet}`].includes(c.field)), { field: 'portrait', value: portrait.path }];
          } catch (error) {
            // A deleted import must not stop other saved choices from
            // being restored. Keep its saved ID so it can be repaired later.
            warnings.push(`${artSet}/${choice.unitId}：${error instanceof Error ? error.message : String(error)}`);
            choices.splice(choices.indexOf(choice), 1);
          }
        }
        if (!choices.length) continue;
        const profiles = artSet === 'hd' ? ['hd', 'hd-retro'] as const : [artSet];
        for (const profile of profiles) {
          const candidates = [
            ...(active === profile ? ['units/unitskin.txt', 'units/unitskin-dis.txt'].map(name => path.join(retail, name)) : []),
            storedSkinPath(retail, profile, false, era), storedSkinPath(retail, profile, true, era),
          ];
          const targets: string[] = [];
          for (const file of candidates) {
            const deployed = await resolveBranchModFile(retail, path.relative(retail, file).split(path.sep).join('/'));
            if (await fs.pathExists(deployed)) targets.push(deployed);
          }
          if (!targets.length) {
            // The retro table must be generated by RetroSkinService first.
            if (profile === 'hd-retro') continue;
            targets.push(await resolveBranchModFile(retail, path.relative(retail, storedSkinPath(retail, profile, !enabled, era)).split(path.sep).join('/')));
          }
          for (const target of new Set(targets)) {
            const before = await fs.pathExists(target) ? await fs.readFile(target, 'utf8') : await (async () => {
              const assets = await AssetSyncService.getAssetsDir(['skin']);
              if (!assets) throw new Error('无法读取游戏皮肤模板');
              return fs.readFile(unitSkinTemplate(path.join(assets, 'quenching'), profile, era), 'utf8');
            })();
            const after = applyBattleUnitScales(writeVersionSkins(before, baseline, artSet, choices),
              battleUnitScalesEnabled(profile, era, configManager.get('modSettings')));
            await fs.ensureDir(path.dirname(target));
            if (before !== after || !(await fs.pathExists(target))) await fs.writeFile(target, after, 'utf8');
          }
        }
      }
      return warnings;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  /** Rewrite selected copies in place, including parked/disabled profiles. */
  refreshCustomSkin(skinId: string, changes?: VersionSkinChoice['changes']): Promise<void> {
    const operation = this.queue.then(async () => {
      const all = configManager.get('skinSelections') || {};
      const next = { ...all };
      for (const [rootKey, selections] of Object.entries(all)) {
        const root = this.key(this.root()) === rootKey ? this.root() : rootKey;
        next[rootKey] = { ...selections };
        for (const artSet of ['sd', 'hd', 'de'] as const) {
          const choices = Object.entries(selections[artSet] || {}).filter(([, id]) => id === skinId)
            .map(([unitId]) => ({ unitId, skinId: changes ? skinId : 'original', changes: changes || [] }));
          if (!choices.length) continue;
          const baseline = await this.baseline(root, artSet);
          for (const branch of ['_retail_', '_ptr_']) {
            const build = path.join(root, branch);
            const active = await activeSkinProfile(build) || 'hd';
            const era = await activeSkinEra(build, configManager.get('modSettings')?.resolvedVersion);
            const profiles: ReadonlyArray<typeof active> = artSet === 'hd' ? ['hd', 'hd-retro'] : [artSet];
            const targets = [
              ...(profiles.includes(active) ? [path.join(build, 'units', 'unitskin.txt'), path.join(build, 'units', 'unitskin-dis.txt')] : []),
              ...profiles.flatMap(profile => [storedSkinPath(build, profile, false, era), storedSkinPath(build, profile, true, era)]),
            ];
            for (const file of targets) {
              const target = await resolveBranchModFile(build, path.relative(build, file).split(path.sep).join('/'));
              if (!(await fs.pathExists(target))) continue;
              const before = await fs.readFile(target, 'utf8');
              await fs.writeFile(target, writeVersionSkins(before, baseline, artSet, choices), 'utf8');
            }
          }
          next[rootKey][artSet] = { ...selections[artSet], ...Object.fromEntries(choices.map(c => [c.unitId, c.skinId])) };
        }
      }
      configManager.set('skinSelections', next);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  async apply(artSet: SkinArtSet, choices: VersionSkinChoice[]): Promise<SkinSelections> {
    const root = this.root();
    // Migration may enqueue profile rewrites; finish it before entering the apply queue.
    const { customSkinService } = await import('./custom-skin-service');
    await customSkinService.repairImportedIcons();
    const operation = this.queue.then(async () => {
      assertArtSet(artSet);
      if (this.root() !== root) throw new Error('游戏目录已切换，请重试');
      choices = choices.map(choice => {
        const saved = customSkinService.getAll().find(skin => skin.id === choice.skinId && skin.artSet === artSet);
        return saved ? { ...choice, changes: saved.config } : choice;
      });
      const baseline = await this.baseline(root, artSet);
      // Validate before enabling/writing any files.
      writeVersionSkins('', baseline, artSet, choices);
      for (const choice of choices) {
        if (choice.skinId === 'original') continue;
        const model = choice.changes.find(c => c.field === `file:${artSet}`)?.value || choice.changes.find(c => c.field === 'file')?.value;
        if (!model) continue;
        const explicit = choice.changes.find(c => c.field === `portrait:${artSet}`)?.value || choice.changes.find(c => c.field === 'portrait')?.value;
        const portrait = await this.portrait(artSet, choice.unitId, model, explicit);
        if (portrait.path) choice.changes = [...choice.changes.filter(c => !['portrait', `portrait:${artSet}`].includes(c.field)), { field: 'portrait', value: portrait.path }];
      }
      if (choices.some(c => usesFullPackageSkinResource(c.changes))) await assertFullPackageInstalled(root);
      const retail = await fs.pathExists(path.join(root, getSelectedGameFolder())) ? path.join(root, getSelectedGameFolder()) : root;
      const modDisabled = await isBranchModDisabled(retail);
      const importedIds = new Set(((configManager.get('customSkins') as unknown as Array<{ id: string; source: string }>) || [])
        .filter(skin => skin.source === 'external').map(skin => skin.id));
      for (const choice of choices) {
        if (!importedIds.has(choice.skinId)) continue;
        for (const change of choice.changes) {
          if (!modDisabled && ['file', 'file:hd', 'portrait', 'portrait:hd'].includes(change.field) && /^cos[\\/]custom[\\/]/i.test(change.value)) {
            await repairImportedModelTextures(path.join(retail, change.value.replace(/\\/g, '/')), retail);
          }
        }
      }
      const targetProfile = artSet === 'hd' &&
        (configManager.get('retroSkinUnits') === true || configManager.get('retroSkinBuildings') === true)
        ? 'hd-retro' : artSet;
      const activeProfile = await activeSkinProfile(retail) || 'hd';
      const era = await activeSkinEra(retail, configManager.get('modSettings')?.resolvedVersion);
      let target: string;
      if (targetProfile === activeProfile) {
        if (modDisabled) {
          const disabled = await resolveBranchModFile(retail, 'units/unitskin-dis.txt');
          const active = await resolveBranchModFile(retail, 'units/unitskin.txt');
          target = await prepareBranchModFileWrite(retail,
            !(await fs.pathExists(active)) && await fs.pathExists(disabled) ? 'units/unitskin-dis.txt' : 'units/unitskin.txt');
          if (!(await fs.pathExists(target))) {
            const assets = await AssetSyncService.getAssetsDir(["skin"]);
            await fs.ensureDir(path.dirname(target));
            await fs.copy(unitSkinTemplate(path.join(assets, 'quenching'), targetProfile, era), target);
          }
        } else {
          await skinService.enableSkins();
          target = path.join(retail, 'units', 'unitskin.txt');
        }
      } else {
        const parked = storedSkinPath(retail, targetProfile, false, era);
        const parkedDisabled = storedSkinPath(retail, targetProfile, true, era);
        target = await fs.pathExists(parked) ? parked
          : await fs.pathExists(parkedDisabled) ? parkedDisabled : parked;
        if (!(await fs.pathExists(target))) {
          const assets = await AssetSyncService.getAssetsDir(["skin"]);
          await fs.ensureDir(path.dirname(target));
          await fs.copy(unitSkinTemplate(path.join(assets, 'quenching'), targetProfile, era), target);
        }
      }
      const before = await fs.readFile(target, 'utf8');
      const after = applyBattleUnitScales(writeVersionSkins(before, baseline, artSet, choices),
        battleUnitScalesEnabled(targetProfile, era, configManager.get('modSettings')));
      await fs.writeFile(target, after, 'utf8');
      const all = configManager.get('skinSelections') || {};
      const current = all[this.key(root)] || {};
      const selections = { ...current, [artSet]: { ...current[artSet], ...Object.fromEntries(choices.map(c => [c.unitId, c.skinId])) } };
      configManager.set('skinSelections', { ...all, [this.key(root)]: selections });
      // Upgrade already-created custom skins when they are selected again.
      const records = customSkinService.getAll();
      configManager.set('customSkins', records.map(skin => {
        const choice = choices.find(c => c.skinId === skin.id && skin.artSet === artSet);
        return choice ? { ...skin, config: choice.changes } : skin;
      }) as never);
      return selections;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
export const versionSkinService = new VersionSkinService();
