import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import fs from 'fs-extra';
import path from 'node:path';

const fixtureParent = path.resolve('_tmp/skin-experience');
await fs.ensureDir(fixtureParent);
const root = await fs.mkdtemp(path.join(fixtureParent, 'quenching-package-switch-'));
const retail = path.join(root, '_retail_');
const resource = path.join(retail, 'units', 'unitskin.txt');
const source = path.join(root, 'package.zip');
const fixture: any = { handlers: {}, config: { war3Path: root, gameChannel: 'retail', channelModEnabled: { retail: true } }, profiles: 0, restores: 0, fail: false };
(globalThis as any).__packageSwitchFixture = fixture;
const mocks: Record<string, string> = {
  electron: 'export const ipcMain={handle:(key,handler)=>f.handlers[key]=handler};export const dialog={};',
  'config-manager': 'export const configManager={get:key=>f.config[key],set:(key,value)=>f.config[key]=value};',
  'asset-sync': 'export const AssetSyncService={getAssetsDir:async()=>"unused-assets",ensurePostProcessingConfig:async()=>{}};',
  'game-launcher': 'export const GameLauncher={};',
  'offline-test-launcher': 'export const registerOfflineTestLauncher=()=>{};',
  'theme-service': 'export const themeService={};',
  'campaign-w3n-merge': 'export const extractCampaignW3nMerged=async()=>{};',
  'campaign-metadata': 'export const readInstalledCampaignMetadata=async()=>null;',
  'full-package-service': 'export const isFullPackageInstalled=async()=>true,isFullPackageInstalledInChannel=async()=>true;',
  'war3-path': 'export const normalizeWar3RootPath=path=>path;',
  'game-channel-switch': 'export const switchGameChannel=async()=>{};',
  'install-space': 'export const getInstallSpaceStatus=async()=>({insufficient:false}),getZipUncompressedBytes=async()=>0;',
  'local-files-service': 'export const registerLocalFilesInBackground=()=>{};',
  'branch-package-copy': 'export const assertNoPendingBranchCopy=async()=>{};',
  'client-mod-files': 'import fs from "fs-extra";import path from "node:path";export const enumerateClientModFiles=async(build,parked)=>await fs.pathExists(path.join(build,...(parked?["QMoff"]:[]),"units","unitskin.txt"))?["units/unitskin.txt"]:[];',
  'full-package-install': 'export const installPackageSources=(...args)=>f.install(...args);',
  'mod-update-service': 'export const assertWarcraftNotRunning=async()=>{};',
  'post-install-profile': 'export const applyInstalledProfile=async(_,options={})=>{if(options.restoreSkinsOnly)f.restores++;else f.profiles++;return[];};',
};
try {
  const bundle = await build({ stdin: { contents: 'export { registerLaunchHandlers } from "./src/Main/ipc/launch-handlers";', resolveDir: process.cwd(), loader: 'ts' },
    platform: 'node', format: 'cjs', packages: 'external', bundle: true, write: false,
    plugins: [{ name: 'package-switch-fixture', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => {
        const name = args.path.split('/').at(-1)!;
        return mocks[name] ? { path: name, namespace: 'fixture' } : undefined;
      });
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ resolveDir: process.cwd(), contents:'const f=globalThis.__packageSwitchFixture;'+mocks[args.path] }));
    } }],
  });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  module.exports.registerLaunchHandlers();
  await fs.outputFile(source, 'source fixture');
  await fs.ensureDir(retail);
  await fs.outputFile(path.join(retail, '.build.info'), 'Active!DEC:1|Version!STRING:0\n1|3.0.1.24368\n');
  fixture.install = async (_sources: string[], _target: string, _progress: unknown, beforeInstall: () => Promise<void>) => {
    if (fixture.fail) throw new Error('fixture extraction failed');
    await beforeInstall();
    if (fixture.failAfterPrepare) throw new Error('fixture copy failed');
    await fs.outputFile(resource, 'new package skin');
    return 16;
  };
  const install = () => fixture.handlers['mod:install-full-package']({ sender: { send() {} } }, [source]);
  const toggle = (enabled: boolean) => fixture.handlers['mod:set-branch-enabled'](null, 'retail', enabled);
  assert.equal((await install()).success, true);
  assert.equal(fixture.config.channelModEnabled.retail, true);
  assert.equal(await fs.readFile(resource, 'utf8'), 'new package skin');
  assert.equal(fixture.profiles, 1);

  await toggle(false);
  assert.equal(fixture.config.channelModEnabled.retail, false);
  assert.equal(await fs.pathExists(resource), false);
  assert.equal((await install()).success, true);
  assert.equal(fixture.config.channelModEnabled.retail, false, 'installation does not turn MOD on');
  assert.equal(await fs.pathExists(resource), false, 'installed resources remain parked while MOD is off');
  assert.equal(await fs.readFile(path.join(retail, 'QMoff', 'units', 'unitskin.txt'), 'utf8'), 'new package skin');
  assert.equal(fixture.profiles, 1, 'off installation does not apply active profiles');
  assert.equal(fixture.restores, 1, 'off installation still restores saved skins into the disabled profile');
  const before = await fs.readFile(path.join(retail, '.quenching', 'branch-toggle.json'), 'utf8');
  fixture.fail = true;
  const originalError = console.error;
  console.error = () => {};
  let failed: any;
  try { failed = await install(); } finally { console.error = originalError; }
  assert.equal(failed.success, false);
  assert.equal(await fs.readFile(path.join(retail, '.quenching', 'branch-toggle.json'), 'utf8'), before);
  fixture.fail = false;
  fixture.failAfterPrepare = true;
  console.error = () => {};
  try { failed = await install(); } finally { console.error = originalError; }
  assert.equal(failed.success, false);
  assert.equal(fixture.config.channelModEnabled.retail, false);
  assert.equal(await fs.pathExists(resource), false, 'a copy failure must restore the disabled state');
  assert.equal(await fs.readFile(path.join(retail, 'QMoff', 'units', 'unitskin.txt'), 'utf8'), 'new package skin');
  fixture.failAfterPrepare = false;
  await toggle(true);
  assert.equal(fixture.config.channelModEnabled.retail, true);
  assert.equal(await fs.readFile(resource, 'utf8'), 'new package skin');
  assert.equal(fixture.profiles, 2, 'explicitly enabling MOD applies the installed resource settings');
  // Unsupported builds must be rejected before extraction, journal recovery or enabling.
  await toggle(false);
  const offJournal = await fs.readFile(path.join(retail, '.quenching', 'branch-toggle.json'), 'utf8');
  await fs.outputFile(path.join(retail, '.build.info'), 'Active!DEC:1|Version!STRING:0\n1|2.0.3.23000\n');
  fixture.install = async () => { throw new Error('unsupported game reached extraction'); };
  console.error = () => {};
  try { failed = await install(); } finally { console.error = originalError; }
  assert.equal(failed.success, false);
  assert.match(failed.error, /Quenching 3\.7 requires/);
  await assert.rejects(toggle(true), /Quenching 3\.7 requires/);
  assert.equal(fixture.config.channelModEnabled.retail, false);
  assert.equal(await fs.readFile(path.join(retail, '.quenching', 'branch-toggle.json'), 'utf8'), offJournal);
  assert.equal(await fs.readFile(path.join(retail, 'QMoff', 'units', 'unitskin.txt'), 'utf8'), 'new package skin');
  console.log('PASS: installing retains MOD on/off, off resources stay in QMoff, failed extraction leaves the switch unchanged, explicit enabling applies resources');
} finally {
  delete (globalThis as any).__packageSwitchFixture;
  assert(path.dirname(root) === fixtureParent && path.basename(root).startsWith('quenching-package-switch-'));
  await fs.remove(root);
}
