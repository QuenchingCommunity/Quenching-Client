import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';

async function isElectronZip(file) {
  try {
    if (fs.statSync(file).size <= 1024 * 1024) return false;
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    return !!zip.file('Electron.app/Contents/MacOS/Electron') && !!zip.file('Electron.app/Contents/Info.plist');
  } catch { return false; }
}

/** Native curl on Unix; no shell, partial-cache reuse or Windows-only binary. */
export async function downloadElectronZip(version, arch, {
  cacheDir = process.env.QUENCHING_ELECTRON_CACHE || path.join(os.homedir(), '.electron'),
  platform = process.platform, run = spawnSync, urls, log = console,
} = {}) {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version) || !['arm64', 'x64'].includes(arch)) {
    throw new Error('Invalid Electron version or Mac architecture');
  }
  const filename = `electron-v${version}-darwin-${arch}.zip`;
  fs.mkdirSync(cacheDir, { recursive: true });
  const destination = path.join(cacheDir, filename);
  if (await isElectronZip(destination)) {
    log.log(`[package-mac-app] using cached ${destination}`);
    return destination;
  }
  const sources = urls || [
    `https://github.com/electron/electron/releases/download/v${version}/${filename}`,
    `https://npmmirror.com/mirrors/electron/v${version}/${filename}`,
    `https://cdn.npmmirror.com/binaries/electron/v${version}/${filename}`,
  ];
  const command = platform === 'win32' ? 'curl.exe' : 'curl';
  const failures = [];
  for (const url of sources) {
    const temporary = `${destination}.${randomUUID()}.part`;
    try {
      log.log(`[package-mac-app] downloading ${url}`);
      const result = run(command, ['--fail', '--location', '--retry', '2', '--retry-max-time', '240',
        '--connect-timeout', '20', '--max-time', '180', '--progress-bar', '--output', temporary, url], {
        stdio: 'inherit', windowsHide: true, timeout: 300000,
      });
      if (result.error?.code === 'ENOENT') throw new Error(`Required download command is unavailable: ${command}`);
      if (!result.error && result.status === 0 && await isElectronZip(temporary)) {
        fs.renameSync(temporary, destination);
        return destination;
      }
      const detail = result.error?.message || `exit ${result.status}; invalid or incomplete Electron ZIP`;
      failures.push(`${url}: ${detail}`);
      log.warn(`[package-mac-app] download failed: ${detail}`);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  throw new Error(`Failed to download ${filename}\n${failures.join('\n')}`);
}
