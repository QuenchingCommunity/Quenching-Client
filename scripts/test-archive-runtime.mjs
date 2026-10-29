// Exercise the actual bundled binary through Electron's ASAR filesystem.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'fs-extra';
import asar from '@electron/asar';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { path7z } = require('7zip-bin-full');
const parent = path.resolve('_tmp/archive-formats');
await fs.ensureDir(parent);
const root = await fs.mkdtemp(path.join(parent, 'runtime-'));
try {
  const app = path.join(root, 'app');
  const moduleRoot = path.dirname(require.resolve('7zip-bin-full/package.json'));
  const moduleTarget = path.join(app, 'node_modules/7zip-bin-full');
  for (const file of ['index.js', 'package.json']) await fs.copy(path.join(moduleRoot, file), path.join(moduleTarget, file));
  const binDir = path.dirname(path7z), relativeBin = path.relative(moduleRoot, binDir);
  await fs.copy(binDir, path.join(moduleTarget, relativeBin), {
    filter: file => !path.relative(binDir, file).split(path.sep).some(part => part === '7zc' || /^7zz(?:c|s|sc)$/.test(part)),
  });
  await build({ entryPoints: ['src/Main/services/archive-extraction.ts'], outfile: path.join(app, 'archive.cjs'),
    bundle: true, platform: 'node', format: 'cjs', external: ['7zip-bin-full'] });
  const archive = path.join(root, 'app.asar');
  await asar.createPackageWithOptions(app, archive, { unpackDir: 'node_modules/7zip-bin-full' });
  const diskBinary = `${archive}.unpacked/node_modules/7zip-bin-full/${relativeBin}/${path.basename(path7z)}`;
  assert(await fs.pathExists(diskBinary));
  if (process.platform === 'win32') assert(await fs.pathExists(path.join(path.dirname(diskBinary), '7z.dll')));
  const sample = path.join(root, 'sample.rar');
  await fs.writeFile(sample, Buffer.from(await fs.readFile('scripts/fixtures/archives/compressed-rar5.base64', 'utf8'), 'base64'));
  const output = path.join(root, 'output');
  const code = `const a=require(process.argv[1]);
    if(!a.archiveToolPath().includes('app.asar.unpacked'))throw Error('Packed executable path');
    a.extractArchive(process.argv[2],process.argv[3]).then(bytes=>console.log(JSON.stringify({bytes,path:a.archiveToolPath()}))).catch(e=>{console.error(e);process.exitCode=1});`;
  const { stdout } = await promisify(execFile)(require('electron'), ['-e', code, `${archive}/archive.cjs`, sample, output], {
    windowsHide: true, timeout: 30000, maxBuffer: 6000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  assert.equal(JSON.parse(stdout.trim()).bytes, 1200);
  assert.equal((await fs.stat(path.join(output, 'test.bin'))).size, 1200);
  console.log('PASS: Electron loaded ASAR module, launched bundled unpacked 7-Zip (with its DLL on Windows), and extracted compressed RAR5.');
} finally { await fs.remove(root); }
