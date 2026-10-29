/** Warcraft III support policy starting with Quenching 3.7.
 * UI names 2.04 / 3.01 mean Blizzard versions 2.0.4 / 3.0.1. */
export type SupportedWar3Version = 'v204' | 'v30' | 'v301';

export function supportedWar3Version(parts: readonly number[]): SupportedWar3Version | null {
  if (parts.length < 2 || !parts.every(part => Number.isSafeInteger(part) && part >= 0)) return null;
  const [major, minor, patch = 0] = parts;
  if (major === 2 && minor === 0 && patch === 4) return 'v204';
  if (major === 3 && minor === 0 && patch === 0) return 'v30';
  if (major > 3 || (major === 3 && (minor > 0 || patch >= 1))) return 'v301';
  return null;
}

export function assertWar3VersionSupported(detected: { parts: readonly number[]; source: string }): SupportedWar3Version {
  const version = detected.source === 'unknown' ? null : supportedWar3Version(detected.parts);
  if (!version) {
    const label = detected.source === 'unknown' ? 'unknown' : detected.parts.join('.');
    throw new Error(`Warcraft III ${label}: Quenching 3.7 requires 2.0.4, 3.0.0 or 3.0.1+. / 淬火 3.7 支持魔兽 2.04、3.0、最新（3.01），请更新游戏或检查所选分支。`);
  }
  return version;
}
