// 导入语句必须在最前面
import "#main/services/update-test-init";
import "#main/index";
import "#main/reaxels/menu";
import { reaxel_MainProcessHub } from '#main/reaxels/main-process-hub';
import { initializeMainWindow } from '#main/initialize-main-window';
import { useBeautifulDevtool } from '#generic/modify-electron/beautiful-devtool';
import { registerAllAPIs } from '#main/api';
import { app, ipcMain, screen } from 'electron';
import { dev } from 'electron-is';
import logger from 'electron-log/main';
import { obsReaction } from 'reaxes';
import si from "systeminformation";
import { channelRecoveryReady } from '#main/services/channel-recovery-init';
import { checkInterruptedClientUpdate, cleanupCompletedClientUpdate } from '#main/services/client-update-service';
import { AssetSyncService } from '#main/services/asset-sync';
import { configManager } from '#main/services/config-manager';
import { startupResourceBarrier } from '#main/services/startup-resource-barrier';
import { restoreIncompatibleVisionModules } from '#main/services/vision-modules';

logger.initialize();

console.log(__NODE_ENV__);

// =====================================================================
// 【修复】搜狗输入法/中文输入法兼容性 - 必须在任何 electron ready 前执行
// 搜狗等第三方 IME 在 Windows 上与 Electron GPU 沙箱冲突导致白屏/不弹窗
// =====================================================================
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('ignore-certificate-errors');

app.whenReady().then(async () => {
	configManager.initializeSystemLanguage();
	try {
		const updateRecovery = await checkInterruptedClientUpdate();
		if (updateRecovery === 'busy' || updateRecovery === 'recovering') {
			app.quit();
			return;
		}
		await channelRecoveryReady;
	} catch (error) {
		console.error('[ClientUpdate] startup recovery failed:', error);
		app.quit();
		return;
	}
	// 注册所有API
	registerAllAPIs();

	const reax_MainProcessHub = reaxel_MainProcessHub();

	obsReaction(() => {
		const { recreateMainWindow, mainWindow } = reax_MainProcessHub;
		if (mainWindow) {
		} else {
			recreateMainWindow({
				openDevTools: dev() && process.env.QUENCHING_DEVTOOLS === '1'
			});
		}
	}, () => [reax_MainProcessHub.mainWindow]);

	// WebUI branding is owned by the client and must not wait for a settings
	// change or a manual resource sync. Run after window creation so a slow disk
	// never delays startup; the resource transaction restores old files on error.
	const configuredGamePath = configManager.get('war3Path');
	if (configuredGamePath) {
		void startupResourceBarrier.foreground(() => AssetSyncService.syncClientWebUIAssets(configuredGamePath)).catch(error => {
			console.error('[Main] Startup WebUI asset sync failed:', error);
		});
		void startupResourceBarrier.foreground(() => AssetSyncService.ensurePostProcessingConfig(configuredGamePath)).catch(error => {
			console.error('[Main] Startup PostProcessingConfig check failed:', error);
		});
		void startupResourceBarrier.exclusive(() => restoreIncompatibleVisionModules(configuredGamePath)).catch(error => {
			console.error('[Main] Startup Vision Mod compatibility recovery failed:', error);
		});
		void startupResourceBarrier.exclusive(() => AssetSyncService.refreshUnitSkinBaseline(configuredGamePath, { restoreSavedSkins: true })).catch(error => {
			console.error('[Main] Startup unitskin baseline check failed:', error);
		});
	}
	setTimeout(() => void cleanupCompletedClientUpdate().catch(error => console.warn('[ClientUpdate] cleanup deferred:', error)), 10000);
	setTimeout(() => void cleanupCompletedClientUpdate().catch(error => console.warn('[ClientUpdate] cleanup deferred:', error)), 30000);

	// mainWindow.setIcon('https://img.piclabo.xyz/2023/10/25/d67adcffb89dd.jpg')
});

// 除了 macOS 外，当所有窗口都被关闭的时候退出程序。 因此, 通常
// 对应用程序和它们的菜单栏来说应该时刻保持激活状态,
// 直到用户使用 Cmd + Q 明确退出
// app.on( 'window-all-closed' , () => {
// 	if( process.platform !== 'darwin' ) app.quit();
// } );

app.whenReady().then(() => {

	const primaryDisplay = screen.getPrimaryDisplay();

	const scaleFactor = primaryDisplay.scaleFactor;


	// console.log( 'HDR support:' , hdrSupported );
});

si.graphics().then(data => {
	console.log("GPU:", data.controllers.map(ctrl => ctrl.model));
});
