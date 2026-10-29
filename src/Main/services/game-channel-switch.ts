import fs from 'fs-extra';
import path from 'path';
import { GameChannel, gameChannelFolder } from '../../shared/game-channel';
import { configManager } from './config-manager';
import { normalizeWar3RootPath } from './war3-path';
import { getSelectedGameChannel, getChannelModEnabled, hasGameChannelDirectory, setChannelModEnabled } from './game-channel';
import { BRANCH_MOD_FOLDERS } from './branch-mod-toggle';
import { assertWarcraftNotRunning } from './mod-update-service';
import { detectWar3Version } from './war3-version';
import { assertWar3VersionSupported } from '../../shared/war3-support';
const LEGACY_MOVE_JOURNAL = '.quenching-channel-switch.json';

/** Everything Quenching keeps inside a branch folder. Never x86_64 or Blizzard data. */
const CHANNEL_ENTRIES = [
    ...BRANCH_MOD_FOLDERS,
    'd30', 'buildings-dis', 'doodads-dis',
    'QMoff', '.quenching', '_patch', '_manual',
    '_QMThirdParty.json', 'quenching-vio.que', 'PostProcessingConfig.txt', 'Mac.txt', 'reg.reg',
];

const BLIZZARD_ENTRIES = new Set(['x86_64', 'x86', 'data', 'locales']);

/** Enabled third-party packs may add top-level folders outside the fixed list. */
async function thirdPartyEntries(buildDir: string): Promise<string[]> {
    const state = await fs.readJson(path.join(buildDir, '_QMThirdParty.json')).catch(() => null);
    const slots: Array<{ enabled?: boolean; files?: unknown }> = Array.isArray(state?.slots) ? state.slots : [];
    const tops = slots
        .filter(slot => slot?.enabled && Array.isArray(slot.files))
        .flatMap(slot => (slot.files as unknown[]).filter((file): file is string => typeof file === 'string'))
        .map(file => file.replace(/\\/g, '/').replace(/^\/+/, '').split('/')[0])
        .filter(name => name && name !== '.' && name !== '..' && !BLIZZARD_ENTRIES.has(name.toLowerCase()));
    return [...new Set(tops)];
}

function channelEntries(extra: string[]): string[] {
    const seen = new Set<string>();
    return [...CHANNEL_ENTRIES, ...extra].filter(name => {
        const key = name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export async function assertNoInterruptedLegacyChannelSwitch(gamePath: string): Promise<void> {
    const root = normalizeWar3RootPath(gamePath);
    if (await fs.pathExists(path.join(root, LEGACY_MOVE_JOURNAL))) {
        throw new Error(`An old channel-move journal exists in ${root}; no files were moved`);
    }
}

/** Only one branch carries the MOD: selecting a branch moves every Quenching entry into it. */
export async function switchGameChannel(gamePath: string, next: GameChannel): Promise<void> {
    if (next !== 'retail' && next !== 'ptr') throw new Error('Invalid game channel');
    const root = normalizeWar3RootPath(gamePath);
    await assertNoInterruptedLegacyChannelSwitch(root);
    if (!(await hasGameChannelDirectory(root, next))) {
        throw new Error(`${gameChannelFolder(next)} does not exist in the selected Warcraft III folder`);
    }
    const current = getSelectedGameChannel();
    // Check the destination before moving any MOD files out of the current branch.
    assertWar3VersionSupported(await detectWar3Version(root, next));
    if (current !== next && await hasGameChannelDirectory(root, current)) {
        await assertWarcraftNotRunning();
        const from = path.join(root, gameChannelFolder(current));
        const to = path.join(root, gameChannelFolder(next));
        for (const name of channelEntries(await thirdPartyEntries(from))) {
            const source = path.join(from, name);
            if (!(await fs.pathExists(source))) continue;
            const target = path.join(to, name);
            await fs.remove(target);
            await fs.move(source, target);
            console.log(`[GameChannel] Moved ${name}: ${gameChannelFolder(current)} -> ${gameChannelFolder(next)}`);
        }
        setChannelModEnabled(next, getChannelModEnabled(current));
        setChannelModEnabled(current, false);
    }
    configManager.set('gameChannel', next);
}
