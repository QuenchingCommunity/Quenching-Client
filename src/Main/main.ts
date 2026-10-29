import { app, BrowserWindow, Menu, Tray, dialog, nativeImage } from 'electron';
import path from 'path';
import { registerAllAPIs } from './api';
import { configManager } from './services/config-manager';
import { assertNoInterruptedLegacyChannelSwitch } from './services/game-channel-switch';
import { LOCAL_APP_TITLE } from '../shared/local-release';

// =====================================================================
// 【修复】搜狗输入法/中文输入法兼容性 & 单实例锁（必须在 app.whenReady 之前执行）
// 搜狗输入法等第三方中文 IME 在 Windows 上与 Electron 的 GPU 沙箱存在冲突，
// 导致渲染进程崩溃，窗口无法显示（白屏/不弹出）。
// 添加以下 Chromium 命令行参数可规避此问题。
// =====================================================================

// 【单实例锁】必须在 app.whenReady() 之前调用，避免竞态条件
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // 已有实例在运行，直接退出当前进程
  app.quit();
  process.exit(0);
}

// 【IME 兼容】禁用 GPU 沙箱 - 修复搜狗输入法等导致渲染进程直接崩溃的问题
app.commandLine.appendSwitch('no-sandbox');
// 【IME 兼容】禁用硬件加速 GPU 合成 - 避免搜狗注入 DLL 导致 GPU 进程崩溃
app.commandLine.appendSwitch('disable-gpu-compositing');
// 【IME 兼容】忽略 GPU 黑名单 - 防止搜狗 IME 驱动版本导致 GPU 被禁用
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// 忽略 SSL 证书错误 (解决开发环境下的自签名证书问题)
app.commandLine.appendSwitch('ignore-certificate-errors');

// 保持对窗口对象的全局引用
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// 开发环境检测
const isDev = process.env.NODE_ENV === 'development';

console.log(`\n[Main] ${LOCAL_APP_TITLE} Starting...`);
console.log(`[Main] NODE_ENV: ${process.env.NODE_ENV}`);

function createWindow(): void {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    title: LOCAL_APP_TITLE,
    width: 960,
    height: 640,
    minWidth: 800,
    minHeight: 560,
    frame: false, // 无边框窗口
    transparent: false,
    backgroundColor: '#000000',
    icon: path.join(__dirname, '../assets/quenching/logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: !isDev
    },
    show: true // 强制显示，方便调试
  });

  // 加载应用
  if (isDev) {
    // 使用 webpack-start 脚本指定的端口 4410
    const devServerUrl = 'http://localhost:4410';
    console.log(`Loading from Dev Server: ${devServerUrl}`);
    mainWindow.loadURL(devServerUrl).catch(err => {
      console.error('Failed to load Dev Server, falling back to local file:', err);
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    });

    // 开发环境下打开开发者工具
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // 调试日志
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });


  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Renderer process gone:', details.reason);
  });

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();

      // 居中显示
      mainWindow.center();

      // 设置最小尺寸
      mainWindow.setMinimumSize(800, 560);
    }
  });

  // 窗口关闭事件处理已移至WindowOperationsAPI，避免重复处理

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 防止新窗口打开
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
}

function createTray(): void {
  // 创建系统托盘图标
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, '../assets/quenching/1.ico')
    : path.join(__dirname, '../assets/quenching/logo.png');

  const trayIcon = nativeImage.createFromPath(iconPath);

  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: '关于淬火试炼',
      click: () => {
        // 发送消息到渲染进程显示关于对话框
        if (mainWindow) {
          mainWindow.webContents.send('show-about');
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip('淬火试炼 - Quenching Mod Client');

  // 双击托盘图标显示窗口
  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// 应用准备就绪
app.whenReady().then(async () => {
  // Recover any interrupted folder renames before IPC or startup asset sync can touch the game.
  const configuredGamePath = configManager.get('war3Path');
  if (configuredGamePath) {
    try {
      await assertNoInterruptedLegacyChannelSwitch(configuredGamePath);
    } catch (error) {
      console.error('[Main] Channel-switch recovery requires attention:', error);
      dialog.showErrorBox('魔兽目录需要人工检查',
        '发现旧版分支搬运的中断记录。为保护你的文件，客户端不会自动移动、删除或覆盖目录；请先人工检查。');
      app.quit();
      return;
    }
  }
  // 注册所有API
  registerAllAPIs();

  // 尽早创建窗口和托盘，保证以最快速度展示主页，不被资源检查等过程阻塞
  createWindow();
  createTray();


  // macOS 下点击 Dock 图标重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });

});

// 所有窗口关闭时退出应用（除了 macOS）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 应用即将退出
app.on('before-quit', () => {
  // 清理资源
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

// 安全设置
app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler((details) => {
    // 阻止应用内创建新窗口，如果需要打开外部链接，可以在这里处理
    // 例如: shell.openExternal(details.url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);

    if (parsedUrl.origin !== 'http://localhost:3000' && !isDev) {
      event.preventDefault();
    }
  });
});

// 设置应用用户模型ID（Windows）
if (process.platform === 'win32') {
  app.setAppUserModelId('com.quenching.modclient');
}

// 【单实例锁已在文件顶部处理】
// 第二个实例启动时，聚焦到已有主窗口
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
});

// 导出主窗口引用（用于其他模块）
export { mainWindow };
