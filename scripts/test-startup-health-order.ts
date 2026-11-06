import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import ts from 'typescript';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const parent = path.resolve('_tmp/update-feedback-20261106'); await fs.ensureDir(parent);
const root = await fs.mkdtemp(path.join(parent, 'startup-health-'));
const resources = (process as any).resourcesPath;
try {
  await fs.ensureDir(path.join(root, 'assets'));
  (process as any).resourcesPath = root;
  const source = ts.createSourceFile('asset-sync.ts', await fs.readFile('src/Main/services/asset-sync.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const service = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AssetSyncService') as ts.ClassDeclaration;
  // Execute the actual methods with an intentionally slow decoder. Previous
  // mocks replaced this class and therefore missed extraction inside resolution.
  const methods = service.members.filter(node => ts.isMethodDeclaration(node) && ['prepareStartupAssets', 'getAssetsDir'].includes(node.name.getText(source)));
  assert.equal(methods.length, 2);
  let ready = false, decoding = false, finish!: () => void;
  const fixture = {
    fs, root, path,
    prepare: async () => { assert.equal(ready, true, 'health acknowledgement must precede all decompression'); decoding = true; await new Promise<void>(resolve => { finish = resolve; }); },
  };
  (globalThis as any).__startupHealth = fixture;
  const contents = `const {fs,root,path,prepare}=globalThis.__startupHealth;
    const app={isPackaged:true,getAppPath:()=>root,getPath:()=>path.join(root,'QMClient.exe')};
    const UNPACKED_RESOURCE_DIRS=[];const prepareBundledAssets=prepare;const resourceCacheLocation=()=>({});
    export class AssetSyncService {${methods.map(node => node.getText(source)).join('\n')}}`;
  const built = await build({ stdin: { contents, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const work = module.exports.AssetSyncService.prepareStartupAssets(() => {}, () => { ready = true; });
  for (let i = 0; i < 20 && !decoding; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert(ready && decoding, 'slow extraction should start only after health is reported');
  finish(); await work;
  console.log('PASS: real asset lookup reports healthy before cold resource extraction');
} finally { (process as any).resourcesPath = resources; delete (globalThis as any).__startupHealth; await fs.remove(root); }
