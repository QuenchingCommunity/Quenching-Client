import { AssetSyncService } from './asset-sync';
import { syncBlightOnStartup } from './blight-service';
import { configManager } from './config-manager';
import { versionSkinService } from './version-skin-service';

/** A package copy is committed before these client-owned settings are applied. */
export async function applyInstalledProfile(
  war3Path: string,
  options: { forceUnitSkinBaseline?: boolean; restoreSkinsOnly?: boolean; onProgress?: (message: string) => void } = {},
): Promise<string[]> {
  const warnings: string[] = [];
  const skippedReasons: Record<string, string> = {
    'third-party-paused': '第三方资源当前接管了淬火文件',
    'mod-disabled': '当前游戏分支的 MOD 已关闭',
    'legacy-package': '旧版资源包尚未完成升级',
    'package-missing': '未识别到完整资源包',
    'classic-mode': '当前经典模式暂停自动资源切换',
  };
  const apply = async (label: string, action: () => Promise<void>) => {
    try { options.onProgress?.(`正在应用${label}`); } catch { /* closed window */ }
    try {
      await action();
    } catch (error: any) {
      const detail = error?.message || String(error);
      console.warn(`[PostInstallProfile] ${label} was not applied:`, error);
      warnings.push(`${label}：${detail}`);
    }
  };

  const restoreSkins = () => apply('已保存的涂装', async () => {
    const missing = await versionSkinService.restoreSelections(war3Path);
    if (missing.length) throw new Error(missing.join('；'));
  });
  if (options.restoreSkinsOnly) { await restoreSkins(); return warnings; }
  let outcome: Awaited<ReturnType<typeof AssetSyncService.syncConfiguredAssets>> | undefined;
  await apply('当前资源配置', async () => {
    outcome = await AssetSyncService.syncConfiguredAssets(war3Path, undefined, { forceUi: true });
    if (outcome !== 'applied') throw new Error(skippedReasons[outcome] || '资源同步未执行');
  });
  if (outcome && outcome !== 'applied') return warnings;
  await apply('腐化地表设置', () => syncBlightOnStartup(war3Path, configManager.get('modSettings') || {}));
  await apply('单位皮肤基线', () => AssetSyncService.refreshUnitSkinBaseline(
    war3Path, { force: options.forceUnitSkinBaseline === true },
  ));
  await restoreSkins();
  return warnings;
}
