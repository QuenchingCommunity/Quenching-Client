import { useQuitHook } from './useQuitHook';
import { reaxel_ScreenAdapter } from '#main/reaxels/screen-adpater';
import { reaxel_ElectronENV } from '#main/reaxels/runtime-paths';
import { useBeautifulDevtool } from '#generic/modify-electron/beautiful-devtool';
import { useOpenDevtools } from '#generic/modify-electron/open-devtools';
import { dev } from 'electron-is';
import { BrowserWindow, BrowserWindowConstructorOptions, screen } from 'electron';
import path from 'path';
import net from 'node:net';
import { startupTelemetry } from './services/startup-telemetry';
import { LOCAL_APP_TITLE } from '../shared/local-release';
import { installBundledResourceStartup } from './services/bundled-resource-startup';


const { runInExcutable, absAppRunningPath, absAssetsPath } = reaxel_ElectronENV();
//4k下的尺寸
const appAttributes = {
	width: 1800,
	height: 1350
}
const devtoolsWidth = 1300;

function isDevServerAvailable(port: number): Promise<boolean> {
	return new Promise(resolve => {
		const socket = net.connect({ host: '127.0.0.1', port });
		let settled = false;
		const finish = (available: boolean) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(available);
		};
		socket.once('connect', () => finish(true));
		socket.once('error', () => finish(false));
		socket.setTimeout(350, () => finish(false));
	});
}

export const initializeMainWindow = async (
	options: BrowserWindowConstructorOptions & ExtraOptions = {

	}
): Promise<BrowserWindow> => {
	const defaultExtraOptions: ExtraOptions = {
		openDevTools: dev() && process.env.QUENCHING_DEVTOOLS === '1',
	}
	const { calcActualAppSize } = reaxel_ScreenAdapter();
	const actualAppSize = await calcActualAppSize();
	const defaultOptions: BrowserWindowConstructorOptions = {
		title: LOCAL_APP_TITLE,
		// Isolated settings are also used by interactive portable test clients.
		// Only explicitly headless automation may suppress the visible window.
		show: process.env.QUENCHING_AUTOMATED_TEST_HEADLESS !== '1',
		webPreferences: {
			devTools: true,
			contextIsolation: true,
			nodeIntegration: false,
			preload: path.join(absAppRunningPath, 'preload.cjs'),
			experimentalFeatures: false,

		},
		center: true,
		resizable: false,
		frame: false, // 无边框窗口
		icon: path.join(absAssetsPath, process.platform === 'win32' ? 'quenching/1.ico' : 'quenching/logo.png')
	};

	options = _.merge({
		...actualAppSize,
	}, defaultExtraOptions, defaultOptions, options);

	if (options.openDevTools) {
		// options.width += devtoolsWidth;
	}
	// console.trace( options );
	const mainWindow = new BrowserWindow(options);
	installBundledResourceStartup(mainWindow);
	mainWindow.on('page-title-updated', event => event.preventDefault());
	// console.log('screen.getPrimaryDisplay().scaleFactor:',screen.getPrimaryDisplay().scaleFactor);
	// 加载 index.html
	try {
		if (__NODE_ENV__ === 'development' && !runInExcutable) {
			if (await isDevServerAvailable(Number(__DEV_PORT__))) {
				try {
					await mainWindow.loadURL(`https://127.0.0.1:${__DEV_PORT__}`);
				} catch (error) {
					console.warn('[Window] Dev server load failed; using local build:', error instanceof Error ? error.message : String(error));
					await mainWindow.loadFile('dist/renderer/index.html');
				}
			} else {
				await mainWindow.loadFile('dist/renderer/index.html');
			}
		} else {
			await mainWindow.loadFile("dist/renderer/index.html");
		}
		// Resource preparation starts only after the renderer's first paint/IPC handshake.
	} catch (error) {
		startupTelemetry.recordStartupFailure(error);
		throw error;
	}

	useQuitHook(mainWindow);
	useBeautifulDevtool(mainWindow);

	mainWindow.webContents.on('did-finish-load', () => {
		console.log('webkit loaded');
		// mainWindowLoaded.resolve( mainWindow );
	});
	if (options.openDevTools) {
		useOpenDevtools(mainWindow, {
			width: ((devtoolsWidth / screen.getPrimaryDisplay().scaleFactor)),
			devtoolsOptions: { mode: 'left', activate: true }
		}
		);
	}



	return mainWindow as BrowserWindow;
};

type ExtraOptions = Partial<{
	openDevTools: boolean,
}>
