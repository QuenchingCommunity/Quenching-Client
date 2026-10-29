import { getSelectedGameFolder } from './game-channel';
import fs from 'fs-extra';
import path from 'path';
import { configManager } from './config-manager';
import { AssetSyncService } from './asset-sync';
import { assertFullPackageInstalled } from './full-package-service';
import { installBundledResourceFile } from './managed-resource-files';
import { activeSkinEra, activeSkinProfile, skinProfileForGraphics, storedSkinPath, unitSkinTemplate } from './unit-skin-profile';
import type { EffectiveGraphics } from '../../shared/mod-profile';
import { isBranchModDisabled } from './branch-mod-toggle';
import { applyBattleUnitScales, battleUnitScalesEnabled, restoreBattleUnitScales } from '../../shared/battle-unit-scale';
import { preserveVersionSkins } from '../../shared/skin-versions';

export interface SkinChange {
  field: string;
  value: string;
}

export interface UnitSkinChange extends SkinChange {
  unitId: string;
}

export function usesFullPackageSkinResource(changes: SkinChange[]): boolean {
  return changes.some((change) => {
    if (change.field !== 'file' && !change.field.startsWith('file:')) {
      return false;
    }

    const normalized = change.value.replace(/\\/g, '/').toLowerCase();
    if (normalized === 'cos/custom' || normalized.startsWith('cos/custom/')) {
      return false;
    }
    return normalized === 'cos' || normalized.startsWith('cos/');
  });
}
export class SkinService {
  /**
   * 获取游戏 units 目录
   */
  private async getUnitsDir(): Promise<{ baseDir: string; unitsDir: string } | null> {
    const war3Path = configManager.get('war3Path');
    if (!war3Path) return null;

    const retailPath = path.join(war3Path, getSelectedGameFolder());
    const baseDir = (await fs.pathExists(retailPath)) ? retailPath : war3Path;
    return { baseDir, unitsDir: path.join(baseDir, 'units') };
  }

  private async skinEra(baseDir: string) {
    return activeSkinEra(baseDir, configManager.get('modSettings')?.resolvedVersion);
  }

  /**
   * 关闭皮肤：unitskin.txt -> unitskin-dis.txt
   */
  async disableSkins(): Promise<boolean> {
    const dirs = await this.getUnitsDir();
    if (!dirs) throw new Error('Warcraft III path not configured');

    const unitskinPath = path.join(dirs.unitsDir, 'unitskin.txt');
    const disabledPath = path.join(dirs.unitsDir, 'unitskin-dis.txt');

    if (await fs.pathExists(unitskinPath)) {
      await fs.remove(disabledPath);
      const profile = await activeSkinProfile(dirs.baseDir) || 'hd';
      const parked = storedSkinPath(dirs.baseDir, profile, true, await this.skinEra(dirs.baseDir));
      await fs.ensureDir(path.dirname(parked));
      await fs.move(unitskinPath, parked, { overwrite: true });
      console.log('[SkinService] Disabled skins: unitskin.txt -> QMoff skin profile');
    }

    return true;
  }

  /**
   * 启用皮肤：unitskin-dis.txt -> unitskin.txt，必要时从模板初始化
   */
  async enableSkins(forceRefresh: boolean = false): Promise<void> {
    const dirs = await this.getUnitsDir();
    if (!dirs) return;
    if (await isBranchModDisabled(dirs.baseDir)) return;

    const unitskinPath = path.join(dirs.unitsDir, 'unitskin.txt');
    const disabledPath = path.join(dirs.unitsDir, 'unitskin-dis.txt');

    if (!(await fs.pathExists(unitskinPath)) && (await fs.pathExists(disabledPath))) {
      await fs.move(disabledPath, unitskinPath, { overwrite: false });
      console.log('[SkinService] Enabled skins: unitskin-dis.txt -> unitskin.txt');
    } else if (await fs.pathExists(unitskinPath)) {
      await fs.remove(disabledPath);
    } else {
      const profile = await activeSkinProfile(dirs.baseDir) || 'hd';
      const parked = storedSkinPath(dirs.baseDir, profile, true, await this.skinEra(dirs.baseDir));
      if (await fs.pathExists(parked)) {
        await fs.ensureDir(dirs.unitsDir);
        await fs.move(parked, unitskinPath, { overwrite: true });
      }
    }

    await this.ensureUnitSkinExists(forceRefresh);
  }

  async isSkinEnabled(): Promise<boolean> {
    const dirs = await this.getUnitsDir();
    if (!dirs) return false;
    return fs.pathExists(path.join(dirs.unitsDir, 'unitskin.txt'));
  }

  /**
   * 确保 unitskin.txt 存在并应用淬火版模板
   */
  async ensureUnitSkinExists(forceRefresh: boolean = false): Promise<void> {
    const dirs = await this.getUnitsDir();
    if (!dirs) return;
    if (await isBranchModDisabled(dirs.baseDir)) return;

    const { baseDir, unitsDir } = dirs;
    const unitskinPath = path.join(unitsDir, 'unitskin.txt');
    const disabledPath = path.join(unitsDir, 'unitskin-dis.txt');
    const exists = await fs.pathExists(unitskinPath);

    if (await fs.pathExists(disabledPath) && !exists) {
      return;
    }
    const currentProfile = await activeSkinProfile(baseDir);
    const era = await this.skinEra(baseDir);
    if (!exists && currentProfile && await fs.pathExists(storedSkinPath(baseDir, currentProfile, true, era))) return;

    if (!exists || forceRefresh) {
      const previous = exists ? await fs.readFile(unitskinPath, 'utf8') : '';
      await fs.ensureDir(unitsDir);

      const assetsDir = await AssetSyncService.getAssetsDir(["skin"]);
      if (!assetsDir) throw new Error('Assets directory not found');

      const settings = configManager.get('modSettings') || {};
      const configured = settings.resolvedGraphics || settings.graphicsSelection;
      const graphics: EffectiveGraphics = configured === 'sd' || configured === 'de' ? configured : 'hd';
      const profile = await activeSkinProfile(baseDir) || skinProfileForGraphics(graphics,
        configManager.get('retroSkinUnits') === true, configManager.get('retroSkinBuildings') === true);
      const sourceFile = unitSkinTemplate(path.join(assetsDir, 'quenching'), profile, era);
      if (await fs.pathExists(sourceFile)) {
        console.log(`[SkinService] Initializing unitskin.txt with quenching template from ${sourceFile}`);
        await installBundledResourceFile(unitsDir, 'unitskin.txt', sourceFile, [sourceFile], '.quenching-skin-template');
        const selections = (configManager.get('skinSelections') || {})[path.resolve(configManager.get('war3Path')).toLowerCase()] || {};
        const text = preserveVersionSkins(await fs.readFile(unitskinPath, 'utf8'), previous, selections);
        await fs.writeFile(unitskinPath, applyBattleUnitScales(text,
          battleUnitScalesEnabled(profile, era, settings)), 'utf8');
      } else {
        console.warn(`[SkinService] Quenching template missing: ${sourceFile}`);
      }
    }
  }

  async applySkin(unitId: string, changes: SkinChange[]): Promise<boolean> {
    return this.applyBatchSkin([{ unitId, changes }]);
  }

  async applyBatchSkin(batchChanges: { unitId: string; changes: SkinChange[] }[]): Promise<boolean> {
    console.log(`[SkinService] applyBatchSkin called with ${batchChanges.length} units`);
    const war3Path = configManager.get('war3Path');
    if (!war3Path) {
      console.error('[SkinService] Warcraft III path not configured');
      throw new Error('Warcraft III path not configured');
    }

    // 自动检测并初始化 unitskin.txt（若已关闭则先恢复）
    if (batchChanges.some((batch) => usesFullPackageSkinResource(batch.changes))) {
      await assertFullPackageInstalled(war3Path);
    }

    await this.enableSkins();

    const dirs = await this.getUnitsDir();
    if (!dirs) {
      console.error('[SkinService] Warcraft III path not configured');
      throw new Error('Warcraft III path not configured');
    }

    const unitskinPath = path.join(dirs.unitsDir, 'unitskin.txt');
    const baseDir = dirs.baseDir;
    console.log(`[SkinService] Target unitskin.txt: ${unitskinPath}`);

    // 如果初始化后还是不存在，则报错
    if (!(await fs.pathExists(unitskinPath))) {
      console.error(`[SkinService] unitskin.txt not found at ${unitskinPath}`);
      throw new Error(`unitskin.txt not found at ${unitskinPath}`);
    }

    let content = restoreBattleUnitScales(await fs.readFile(unitskinPath, 'utf-8'));
    let lines = content.split(/\r?\n/);

    for (const item of batchChanges) {
      const { unitId, changes } = item;
      console.log(`[SkinService] Applying changes to unit [${unitId}]:`, changes);

      // Find the section
      const sectionHeader = `[${unitId}]`;
      let sectionStartIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === sectionHeader) {
          sectionStartIndex = i;
          break;
        }
      }

      if (sectionStartIndex === -1) {
        // If section not found, append it to the end
        lines.push('');
        lines.push(sectionHeader);
        sectionStartIndex = lines.length - 1;
      }

      // Update fields within the section
      for (const change of changes) {
        let finalValue = change.value;

        // 如果是本地绝对路径，需要处理模型搬家
        if (path.isAbsolute(change.value) && (change.value.endsWith('.mdx') || change.value.endsWith('.mdl'))) {
          try {
            const fileName = path.basename(change.value);
            const customSkinsDir = path.join(baseDir, 'CustomSkins', unitId);
            await fs.ensureDir(customSkinsDir);
            const targetPath = path.join(customSkinsDir, fileName);

            // 复制文件到魔兽目录
            await fs.copy(change.value, targetPath);

            // 转换成相对路径供 unitskin.txt 使用
            finalValue = `CustomSkins\\${unitId}\\${fileName}`;
          } catch (error) {
            console.error('Failed to copy custom model file:', error);
            // 如果复制失败，保留原值（虽然可能不生效）
          }
        }

        let found = false;
        // Search from the section header downwards until the next section or end of file
        for (let i = sectionStartIndex + 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith('[') && line.endsWith(']')) {
            // Reached next section without finding the field
            break;
          }

          if (line.startsWith(`${change.field}=`)) {
            lines[i] = `${change.field}=${finalValue}`;
            found = true;
            break;
          }
        }

        if (!found) {
          // If field not found, insert it right after the section header
          lines.splice(sectionStartIndex + 1, 0, `${change.field}=${finalValue}`);
        }
      }
    }

    const profile = await activeSkinProfile(baseDir) || 'hd';
    await fs.writeFile(unitskinPath, applyBattleUnitScales(lines.join('\r\n'),
      battleUnitScalesEnabled(profile, await this.skinEra(baseDir), configManager.get('modSettings'))), 'utf-8');
    return true;
  }
}

export const skinService = new SkinService();
