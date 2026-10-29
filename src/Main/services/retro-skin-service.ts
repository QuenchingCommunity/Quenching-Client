import { resourcePath } from '../../shared/bundled-resource-paths.mjs';
import { getSelectedGameFolder } from './game-channel';
import fs from 'fs-extra';

import path from 'path';
import os from 'node:os';

import { configManager } from './config-manager';

import { skinService } from './skin-service';

import { AssetSyncService } from './asset-sync';
import { assertFullPackageInstalled } from './full-package-service';
import { preserveVersionSkins } from '../../shared/skin-versions';
import { applyBattleUnitScales, battleUnitScalesEnabled } from '../../shared/battle-unit-scale';
import { installBundledResourceFile } from './managed-resource-files';
import { activeSkinEra, storedSkinPath, switchUnitSkinProfile, unitSkinTemplate } from './unit-skin-profile';



export interface RetroSkinStatus {

  unitsEnabled: boolean;

  buildingsEnabled: boolean;

  unitsDirName: string | null;

  buildingsDirName: string | null;

  unitskinExists: boolean;

}



type SectionCategory = 'units' | 'buildings' | 'unknown';



interface SkinSection {

  id: string;

  lines: string[];

  category: SectionCategory;

}



const UNIT_DIR_CANDIDATES = ['RUnits', 'Runits'] as const;

const BUILDING_DIR_CANDIDATES = ['Rbuildings'] as const;



export class RetroSkinService {

  private async getRetailDir(): Promise<string> {

    const war3Path = configManager.get('war3Path');

    if (!war3Path) {

      throw new Error('Warcraft III path not configured');

    }



    const retailPath = path.join(war3Path, getSelectedGameFolder());

    return (await fs.pathExists(retailPath)) ? retailPath : war3Path;

  }



  async resolveRetroDirNames(baseDir: string): Promise<{ unitsDirName: string | null; buildingsDirName: string | null }> {

    let unitsDirName: string | null = null;

    let buildingsDirName: string | null = null;



    for (const name of UNIT_DIR_CANDIDATES) {

      if (await fs.pathExists(path.join(baseDir, name))) {

        unitsDirName = name;

        break;

      }

    }



    for (const name of BUILDING_DIR_CANDIDATES) {

      if (await fs.pathExists(path.join(baseDir, name))) {

        buildingsDirName = name;

        break;

      }

    }



    return { unitsDirName, buildingsDirName };

  }



  private classifySection(lines: string[]): SectionCategory {

    let category: SectionCategory = 'unknown';



    for (const line of lines) {

      const trimmed = line.trim();

      if (/^file=war3\.w3mod:units\\/i.test(trimmed) || /^file=units\\/i.test(trimmed)) {

        return 'units';

      }

      if (/^file=war3\.w3mod:buildings\\/i.test(trimmed) || /^file=buildings\\/i.test(trimmed)) {

        return 'buildings';

      }

      if (/^buildingShadow=/i.test(trimmed) && category === 'unknown') {

        category = 'buildings';

      }

    }



    return category;

  }



  private parseSections(content: string): SkinSection[] {

    const lines = content.split(/\r?\n/);

    const sections: SkinSection[] = [];

    let current: SkinSection | null = null;



    for (const line of lines) {

      const trimmed = line.trim();

      if (trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed.length > 2) {

        if (current) {

          current.category = this.classifySection(current.lines);

          sections.push(current);

        }

        current = {

          id: trimmed.slice(1, -1),

          lines: [line],

          category: 'unknown',

        };

      } else if (current) {

        current.lines.push(line);

      }

    }



    if (current) {

      current.category = this.classifySection(current.lines);

      sections.push(current);

    }



    return sections;

  }



  private sectionsToMap(sections: SkinSection[]): Map<string, SkinSection> {

    return new Map(sections.map((section) => [section.id, section]));

  }



  private shouldUseRetroSection(category: SectionCategory, unitsEnabled: boolean, buildingsEnabled: boolean): boolean {

    if (category === 'units') {

      return unitsEnabled;

    }

    if (category === 'buildings') {

      return buildingsEnabled;

    }

    return unitsEnabled;

  }



  private transformSectionLines(

    lines: string[],

    unitsDirName: string | null,

    buildingsDirName: string | null

  ): string[] {

    return lines.map((line) => {

      const unitMatch = line.match(/^(file=)war3\.w3mod:units\\(.+)$/i);

      if (unitMatch && unitsDirName) {

        return `${unitMatch[1]}${unitsDirName}\\${unitMatch[2]}`;

      }



      const buildingMatch = line.match(/^(file=)war3\.w3mod:buildings\\(.+)$/i);

      if (buildingMatch && buildingsDirName) {

        return `${buildingMatch[1]}${buildingsDirName}\\${buildingMatch[2]}`;

      }



      return line;

    });

  }



  private async readAssetTemplate(fileName: string): Promise<string> {

    const assetsDir = await AssetSyncService.getAssetsDir(["skin"]);

    const templatePath = path.isAbsolute(fileName) ? fileName : resourcePath(path.join(assetsDir, 'quenching'), fileName);



    if (!(await fs.pathExists(templatePath))) {

      throw new Error(`Skin template not found: ${templatePath}`);

    }



    return fs.readFile(templatePath, 'utf-8');

  }



  private buildMergedUnitskinContent(

    normalSections: SkinSection[],

    retroSections: SkinSection[],

    unitsEnabled: boolean,

    buildingsEnabled: boolean,

    unitsDirName: string | null,

    buildingsDirName: string | null

  ): string {

    const normalMap = this.sectionsToMap(normalSections);

    const retroMap = this.sectionsToMap(retroSections);

    const outputLines: string[] = [];



    for (const section of normalSections) {

      const category = section.category;

      const useRetro = this.shouldUseRetroSection(category, unitsEnabled, buildingsEnabled);



      let sectionLines: string[];

      if (useRetro && retroMap.has(section.id)) {

        sectionLines = this.transformSectionLines(

          retroMap.get(section.id)!.lines,

          unitsEnabled ? unitsDirName : null,

          buildingsEnabled ? buildingsDirName : null

        );

      } else {

        sectionLines = (normalMap.get(section.id) ?? section).lines;

      }



      if (outputLines.length > 0) {

        outputLines.push('');

      }

      outputLines.push(...sectionLines);

    }



    return outputLines.join('\r\n');

  }



  async getStatus(): Promise<RetroSkinStatus> {

    const baseDir = await this.getRetailDir();

    const { unitsDirName, buildingsDirName } = await this.resolveRetroDirNames(baseDir);

    const unitskinPath = path.join(baseDir, 'units', 'unitskin.txt');



    return {

      unitsEnabled: configManager.get('retroSkinUnits') ?? false,

      buildingsEnabled: configManager.get('retroSkinBuildings') ?? false,

      unitsDirName,

      buildingsDirName,

      unitskinExists: await fs.pathExists(unitskinPath),

    };

  }



  async apply(options: { unitsEnabled?: boolean; buildingsEnabled?: boolean }): Promise<RetroSkinStatus> {

    const baseDir = await this.getRetailDir();

    const unitsEnabled = options.unitsEnabled ?? configManager.get('retroSkinUnits') ?? false;

    const buildingsEnabled = options.buildingsEnabled ?? configManager.get('retroSkinBuildings') ?? false;

    if (unitsEnabled || buildingsEnabled) {
      await assertFullPackageInstalled(configManager.get('war3Path'));
    }



    const unitskinPath = path.join(baseDir, 'units', 'unitskin.txt');

    const disabledPath = path.join(baseDir, 'units', 'unitskin-dis.txt');

    const assetsDir = await AssetSyncService.getAssetsDir(["skin"]);
    const selectedProfile = unitsEnabled || buildingsEnabled ? 'hd-retro' : 'hd';
    const era = await activeSkinEra(baseDir, configManager.get('modSettings')?.resolvedVersion);
    const selections = (configManager.get('skinSelections') || {})[path.resolve(configManager.get('war3Path')).toLowerCase()] || {};
    await switchUnitSkinProfile(baseDir, path.join(assetsDir, 'quenching'), selectedProfile, era, { selections });
    const parkedDisabled = storedSkinPath(baseDir, selectedProfile, true, era);
    const skinIsDisabled = !(await fs.pathExists(unitskinPath)) && await fs.pathExists(parkedDisabled);
    const previousPath = skinIsDisabled ? parkedDisabled
      : await fs.pathExists(unitskinPath) ? unitskinPath : disabledPath;
    const previous = await fs.pathExists(previousPath) ? await fs.readFile(previousPath, 'utf8') : '';
    const unitsDir = path.dirname(unitskinPath);
    const normalSource = unitSkinTemplate(path.join(assetsDir, 'quenching'), 'hd', era);
    const retroSource = unitSkinTemplate(path.join(assetsDir, 'quenching'), 'hd-retro', era);
    const normalTemplate = await this.readAssetTemplate(normalSource);

    if (await fs.pathExists(disabledPath) && !(await fs.pathExists(unitskinPath))) {
      await skinService.enableSkins();
    }

    const writeGeneratedSkin = async (content: string): Promise<void> => {
      content = applyBattleUnitScales(content,
        battleUnitScalesEnabled(selectedProfile, era, configManager.get('modSettings')));
      if (skinIsDisabled) {
        await fs.outputFile(parkedDisabled, content, 'utf8');
        return;
      }
      const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'quenching-retro-skin-'));
      try {
        const generated = path.join(staging, 'unitskin.txt');
        await fs.writeFile(generated, content, 'utf8');
        await installBundledResourceFile(unitsDir, 'unitskin.txt', generated,
          [normalSource, retroSource], '.quenching-skin-template');
      } finally {
        await fs.remove(staging);
      }
    };

    if (!unitsEnabled && !buildingsEnabled) {
      console.log('[RetroSkinService] Both retro toggles off, restoring normal unitskin.txt');
      await writeGeneratedSkin(preserveVersionSkins(normalTemplate, previous, { hd: selections.hd }));
      configManager.set('retroSkinUnits', unitsEnabled);
      configManager.set('retroSkinBuildings', buildingsEnabled);
      return this.getStatus();

    }



    const { unitsDirName, buildingsDirName } = await this.resolveRetroDirNames(baseDir);



    if (unitsEnabled && !unitsDirName) {

      throw new Error('RUnits/Runits directory not found in game installation');

    }

    if (buildingsEnabled && !buildingsDirName) {

      throw new Error('Rbuildings directory not found in game installation');

    }



    const retroTemplate = await this.readAssetTemplate('skin/unitskin-old.txt');

    const normalSections = this.parseSections(normalTemplate);

    const retroSections = this.parseSections(retroTemplate);



    const mergedContent = this.buildMergedUnitskinContent(

      normalSections,

      retroSections,

      unitsEnabled,

      buildingsEnabled,

      unitsDirName,

      buildingsDirName

    );



    await writeGeneratedSkin(preserveVersionSkins(mergedContent, previous, { hd: selections.hd }));
    configManager.set('retroSkinUnits', unitsEnabled);
    configManager.set('retroSkinBuildings', buildingsEnabled);

    console.log(

      `[RetroSkinService] Wrote merged unitskin.txt (retro units=${unitsEnabled}, retro buildings=${buildingsEnabled})`

    );



    return this.getStatus();

  }

}



export const retroSkinService = new RetroSkinService();


