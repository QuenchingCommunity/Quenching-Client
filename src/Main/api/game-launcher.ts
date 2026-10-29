import { ipcMain, shell } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { extractArchive } from '../services/archive-extraction';

// 游戏启动API
export class GameLauncherAPI {
  static register() {
    // 启动游戏
    // CONFLICT: This is handled by src/Main/ipc/launch-handlers.ts using the new ConfigManager service.
    // ipcMain.handle('game:launch', async (event, executablePath: string) => {
    //   try {
    //     console.log('Launching game:', executablePath);
    //     
    //     // 检查可执行文件是否存在
    //     const exists = await fs.pathExists(executablePath);
    //     if (!exists) {
    //       throw new Error(`游戏可执行文件不存在: ${executablePath}`);
    //     }
    //     
    //     // 获取游戏目录
    //     const gameDir = path.dirname(executablePath);
    //     
    //     // 启动游戏进程
    //     const gameProcess = spawn(executablePath, [], {
    //       cwd: gameDir,
    //       detached: true,
    //       stdio: 'ignore'
    //     });
    //     
    //     // 分离进程，让游戏独立运行
    //     gameProcess.unref();
    //     
    //     return { success: true, pid: gameProcess.pid };
    //   } catch (error) {
    //     console.error('Failed to launch game:', error);
    //     throw error;
    //   }
    // });

    // 打开外部链接
    ipcMain.handle('shell:openExternal', async (event, url: string) => {
      try {
        await shell.openExternal(url);
        return true;
      } catch (error) {
        console.error('Failed to open external URL:', error);
        throw error;
      }
    });

    // 显示文件夹
    ipcMain.handle('shell:showItemInFolder', async (event, fullPath: string) => {
      try {
        shell.showItemInFolder(fullPath);
        return true;
      } catch (error) {
        console.error('Failed to show item in folder:', error);
        throw error;
      }
    });

    // 扫描目录文件
    ipcMain.handle('file:scanDirectory', async (event, dirPath: string, extensions: string[]) => {
      try {
        const files: Array<{
          name: string;
          path: string;
          size: number;
          extension: string;
        }> = [];
        
        const items = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const item of items) {
          if (item.isFile()) {
            const ext = path.extname(item.name).toLowerCase();
            if (extensions.includes(ext.slice(1))) {
              const fullPath = path.join(dirPath, item.name);
              const stats = await fs.stat(fullPath);
              
              files.push({
                name: item.name,
                path: fullPath,
                size: stats.size,
                extension: ext
              });
            }
          }
        }
        
        return files;
      } catch (error) {
        console.error('Failed to scan directory:', error);
        return [];
      }
    });

    // 解压文件
    ipcMain.handle('file:extractArchive', async (event, archivePath: string, targetPath: string) => {
      try {
        await extractArchive(archivePath, targetPath);
        return true;
      } catch (error) {
        console.error('Failed to extract archive:', error);
        throw error;
      }
    });
  }
}
