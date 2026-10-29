import { resourcePath } from '../../shared/bundled-resource-paths.mjs';
import fs from 'fs-extra';
import path from 'node:path';
import type { EffectiveGraphics } from '../../shared/mod-profile';
import { preserveVersionSkins, type SkinSelections } from '../../shared/skin-versions';
import { applyBattleUnitScales, battleUnitScalesEnabled } from '../../shared/battle-unit-scale';

export type UnitSkinProfile = 'sd' | 'hd' | 'hd-retro' | 'de';
/** 3.0 and the 2.x/1.x clients read different unitskin baselines, so their copies are kept apart. */
export type UnitSkinEra = 'v30' | 'v20';
const PROFILES = new Set<UnitSkinProfile>(['sd', 'hd', 'hd-retro', 'de']);
const ERAS = new Set<UnitSkinEra>(['v30', 'v20']);
const TEMPLATE: Record<UnitSkinProfile, string> = {
  sd: 'unitskin-sd.txt',
  hd: 'unitskin-new.txt',
  'hd-retro': 'unitskin-old.txt',
  de: 'unitskin-de.txt',
};

function marker(retailDir: string): string {
  return path.join(retailDir, '.quenching', 'unit-skin-profile.json');
}

export function skinProfileForGraphics(graphics: EffectiveGraphics, retroUnits: boolean, retroBuildings: boolean): UnitSkinProfile {
  return graphics === 'hd' && (retroUnits || retroBuildings) ? 'hd-retro' : graphics;
}

export function skinEraForVersion(version: string | undefined): UnitSkinEra {
  return !version || version === 'v30' || version === 'v301' ? 'v30' : 'v20';
}

export function unitSkinTemplate(quenchingDir: string, profile: UnitSkinProfile, era: UnitSkinEra): string {
  return era === 'v20' && profile !== 'hd-retro'
    ? resourcePath(quenchingDir, 'skin', 'legacy', TEMPLATE[profile])
    : resourcePath(quenchingDir, 'skin', TEMPLATE[profile]);
}

export function storedSkinPath(retailDir: string, profile: UnitSkinProfile, disabled: boolean, era: UnitSkinEra): string {
  return path.join(retailDir, 'QMoff', 'skin-profiles', era, profile, disabled ? 'unitskin-dis.txt' : 'unitskin.txt');
}

/** Bump when the bundled baselines change; copies built from an older baseline are replaced once. */
export const UNIT_SKIN_BASELINE = 5;

/** Readability changes reuse the same skin table, including disabled skin copies. */
export async function syncUnitSkinBattleMode(retailDir: string, profile: UnitSkinProfile, era: UnitSkinEra, settings: unknown): Promise<void> {
  const enabled = battleUnitScalesEnabled(profile, era, settings);
  for (const file of [path.join(retailDir, 'units', 'unitskin.txt'), path.join(retailDir, 'units', 'unitskin-dis.txt'),
    storedSkinPath(retailDir, profile, false, era), storedSkinPath(retailDir, profile, true, era)]) {
    if (!(await fs.pathExists(file))) continue;
    const before = await fs.readFile(file, 'utf8');
    const after = applyBattleUnitScales(before, enabled);
    if (before !== after) await fs.writeFile(file, after, 'utf8');
  }
}

async function readMarker(retailDir: string): Promise<{ profile: UnitSkinProfile | null; era: UnitSkinEra | null; baseline: number | null }> {
  const state = await fs.readJson(marker(retailDir)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const valid = state?.schema === 1 && PROFILES.has(state.profile);
  return {
    profile: valid ? state.profile : null,
    era: valid && ERAS.has(state.era) ? state.era : null,
    baseline: valid && typeof state.baseline === 'number' ? state.baseline : null,
  };
}

export async function activeSkinProfile(retailDir: string): Promise<UnitSkinProfile | null> {
  return (await readMarker(retailDir)).profile;
}

/** The era of the active unitskin, or the one implied by the resolved game version before any switch. */
export async function activeSkinEra(retailDir: string, resolvedVersion?: string): Promise<UnitSkinEra> {
  return (await readMarker(retailDir)).era ?? skinEraForVersion(resolvedVersion);
}

// Earlier SD transitions parked the entire units directory; recover its skin
// before the remaining unit models are restored.
async function recoverLegacyParkedSkin(retailDir: string): Promise<void> {
  const units = path.join(retailDir, 'units');
  const hasCurrent = await fs.pathExists(path.join(units, 'unitskin.txt')) || await fs.pathExists(path.join(units, 'unitskin-dis.txt'));
  for (const name of ['unitskin.txt', 'unitskin-dis.txt']) {
    const old = path.join(retailDir, 'QMoff', 'units', name);
    if (!hasCurrent && await fs.pathExists(old)) {
      await fs.ensureDir(units);
      await fs.move(old, path.join(units, name), { overwrite: true });
      break;
    }
  }
  for (const name of ['unitskin.txt', 'unitskin-dis.txt']) await fs.remove(path.join(retailDir, 'QMoff', 'units', name));
}

/**
 * Bring unitskin copies up to the current baseline. Copies from before the
 * 2.x/3.0 split were all built from the 2.x baseline, so they move to the 2.x
 * slot; a 3.0 install then starts from the 3.0 template. `force` rebuilds the
 * current profile from its template after a package install overwrote it.
 */
export async function refreshUnitSkinBaseline(
  retailDir: string,
  quenchingDir: string,
  fallbackProfile: UnitSkinProfile,
  fallbackEra: UnitSkinEra,
  options: { force?: boolean; selections?: SkinSelections } = {},
): Promise<{ refreshed: boolean; profile: UnitSkinProfile; era: UnitSkinEra }> {
  const state = await readMarker(retailDir);
  const profile = state.profile ?? fallbackProfile;
  const era = state.era ?? fallbackEra;
  if (!options.force && state.baseline === UNIT_SKIN_BASELINE) return { refreshed: false, profile, era };

  const template = unitSkinTemplate(quenchingDir, profile, era);
  if (!(await fs.pathExists(template))) throw new Error(`Missing ${era} ${profile} unit skin template: ${template}`);
  const units = path.join(retailDir, 'units');
  const active = path.join(units, 'unitskin.txt');
  const disabled = path.join(units, 'unitskin-dis.txt');
  const profilesRoot = path.join(retailDir, 'QMoff', 'skin-profiles');
  const writeMarker = () => fs.outputJson(marker(retailDir), { schema: 1, profile, era, baseline: UNIT_SKIN_BASELINE });

  const preSplit = state.baseline === null;
  if (preSplit) {
    await recoverLegacyParkedSkin(retailDir);
    for (const parkedProfile of PROFILES) {
      const old = path.join(profilesRoot, parkedProfile);
      if (await fs.pathExists(old)) await fs.move(old, path.join(profilesRoot, 'v20', parkedProfile), { overwrite: true });
    }
  }

  const hasActive = await fs.pathExists(active);
  const current = hasActive ? active : await fs.pathExists(disabled) ? disabled : null;
  const wasDisabled = !hasActive && (current !== null || await fs.pathExists(storedSkinPath(retailDir, profile, true, era)));

  if (preSplit && !options.force && era === 'v20' && (current || wasDisabled)) {
    await writeMarker();
    return { refreshed: false, profile, era };
  }
  if (preSplit && current) {
    const kept = storedSkinPath(retailDir, profile, wasDisabled, 'v20');
    if (!(await fs.pathExists(kept))) {
      await fs.ensureDir(path.dirname(kept));
      await fs.move(current, kept);
    }
  }

  const previous = !preSplit && current ? await fs.readFile(current, 'utf8')
    : !preSplit && await fs.pathExists(storedSkinPath(retailDir, profile, true, era))
      ? await fs.readFile(storedSkinPath(retailDir, profile, true, era), 'utf8') : '';
  const rebuild = async (source: string, previousText: string) => preserveVersionSkins(
    await fs.readFile(source, 'utf8'), previousText, options.selections || {});
  // Already parked profiles must receive the new baseline as well.
  for (const parkedProfile of ['sd', 'hd', 'de'] as const) for (const disabledCopy of [false, true]) {
    const parked = storedSkinPath(retailDir, parkedProfile, disabledCopy, 'v30');
    if (!(await fs.pathExists(parked))) continue;
    const source = unitSkinTemplate(quenchingDir, parkedProfile, 'v30');
    await fs.writeFile(parked, await rebuild(source, await fs.readFile(parked, 'utf8')), 'utf8');
  }

  await fs.remove(active);
  await fs.remove(disabled);
  await fs.remove(storedSkinPath(retailDir, profile, false, era));
  await fs.remove(storedSkinPath(retailDir, profile, true, era));
  const destination = wasDisabled ? storedSkinPath(retailDir, profile, true, era) : active;
  await fs.ensureDir(path.dirname(destination));
  await fs.writeFile(destination, await rebuild(template, previous), 'utf8');
  await writeMarker();
  console.log(`[UnitSkin] Rebuilt ${era} ${profile} unitskin from baseline ${UNIT_SKIN_BASELINE}${wasDisabled ? ' (disabled)' : ''}`);
  return { refreshed: true, profile, era };
}

/** Keep one profile active and every other profile of either era under QMoff. */
export async function switchUnitSkinProfile(
  retailDir: string,
  quenchingDir: string,
  desired: UnitSkinProfile,
  desiredEra: UnitSkinEra,
  options: { selections?: SkinSelections } = {},
): Promise<{ created: boolean; switched: boolean }> {
  const units = path.join(retailDir, 'units');
  const active = path.join(units, 'unitskin.txt');
  const disabled = path.join(units, 'unitskin-dis.txt');
  const outdated = await refreshUnitSkinBaseline(retailDir, quenchingDir, desired, desiredEra, options);
  const state = await readMarker(retailDir);
  const oldProfile = state.profile || 'hd';
  const oldEra = state.era || desiredEra;
  const template = unitSkinTemplate(quenchingDir, desired, desiredEra);
  if (!(await fs.pathExists(template))) throw new Error(`Missing ${desiredEra} ${desired} unit skin template: ${template}`);

  const hasActive = await fs.pathExists(active);
  const hasDisabled = await fs.pathExists(disabled);
  if (hasActive && hasDisabled) await fs.remove(disabled);
  const wasDisabled = !hasActive && (hasDisabled || await fs.pathExists(storedSkinPath(retailDir, oldProfile, true, oldEra)));
  const unchanged = state.profile === desired && oldEra === desiredEra;

  if (unchanged && (hasActive || (!hasDisabled && wasDisabled))) {
    return { created: outdated.refreshed, switched: false };
  }

  if (hasActive || hasDisabled) {
    const old = hasActive ? active : disabled;
    if (outdated.refreshed && oldProfile === 'hd-retro') {
      // A just-rebuilt retro file is the raw template, not a merged skin; regenerate it on return.
      await fs.remove(old);
    } else {
      const parked = storedSkinPath(retailDir, oldProfile, wasDisabled, oldEra);
      await fs.ensureDir(path.dirname(parked));
      await fs.move(old, parked, { overwrite: true });
    }
  }

  const destination = wasDisabled ? storedSkinPath(retailDir, desired, true, desiredEra) : active;
  const parkedDesired = storedSkinPath(retailDir, desired, wasDisabled, desiredEra);
  const alternateParked = storedSkinPath(retailDir, desired, !wasDisabled, desiredEra);
  let created = false;
  await fs.ensureDir(units);
  if (parkedDesired === destination && await fs.pathExists(destination)) {
    // The selected profile is disabled; its copy already lives in QMoff.
  } else if (await fs.pathExists(parkedDesired)) {
    await fs.move(parkedDesired, destination, { overwrite: true });
  } else if (await fs.pathExists(alternateParked)) {
    await fs.move(alternateParked, destination, { overwrite: true });
  } else {
    await fs.copy(template, destination, { overwrite: true });
    created = true;
  }
  await fs.outputJson(marker(retailDir), { schema: 1, profile: desired, era: desiredEra, baseline: UNIT_SKIN_BASELINE });
  return { created, switched: !unchanged };
}
