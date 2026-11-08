import fs from 'fs-extra';
import path from 'node:path';

/** Restore third-party originals before the MOD switch touches their paths. */
export async function disableBranchThirdPartyModules(buildDir: string): Promise<void> {
  const visionFile = path.join(buildDir, '.quenching-vision-modules.json');
  const vision = await fs.readJson(visionFile).catch(error => {
    if (error.code === 'ENOENT') return {};
    throw error;
  });
  if (Object.keys(vision).length) {
    try {
      const { disableVisionModulesForBranch } = await import('./vision-modules');
      await disableVisionModulesForBranch(buildDir);
    } catch (error) {
      throw new Error(`关闭 Vision Mod 失败（${visionFile}）：${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  const slotsFile = path.join(buildDir, '_QMThirdParty.json');
  const state = await fs.readJson(slotsFile).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (state) {
    if (!Array.isArray(state.slots)) throw Error(`第三方资源状态文件无效：${slotsFile}`);
    if (state.slots.some((slot: any) => slot.enabled)) {
      try {
        const { disableThirdPartySlotsForBranch } = await import('./third-party-resources');
        await disableThirdPartySlotsForBranch(buildDir);
      } catch (error) {
        throw new Error(`关闭第三方资源失败（${slotsFile}）：${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }
  }
}
