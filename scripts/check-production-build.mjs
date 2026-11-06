import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {TEST_ONLY_ENVIRONMENT} from './lib/build-channel-policy.mjs';

export async function checkProductionBuild(root = path.resolve('.')) {
  const release=JSON.parse(await fs.readFile(path.join(root,'release-version.json'),'utf8'));
  const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  const identity=JSON.parse(await fs.readFile(path.join(root,'assets/quenching/local-release.json'),'utf8'));
  assert.equal(release.channel,'production');assert.equal(identity.channel,'production');
  assert.equal(identity.internalVersion,pkg.version);assert.equal(identity.label,release.displayVersion);
  const files=[];
  async function walk(folder){for(const entry of await fs.readdir(folder,{withFileTypes:true})){
    const file=path.join(folder,entry.name);if(entry.isDirectory())await walk(file);else if(/\.(?:js|cjs|html|css)$/.test(entry.name))files.push(file);
  }}
  await walk(path.join(root,'dist'));
  const forbidden=['quenching-update-test.json','game:launch-offline-starter','launchOfflineStarterMap',
    'home-offline-test-button','main.offlineTest.',...TEST_ONLY_ENVIRONMENT];
  for(const file of files){const text=await fs.readFile(file,'utf8');for(const marker of forbidden)assert(!text.includes(marker),`${path.relative(root,file)} retains TEST-only content: ${marker}`);}
  const html=await fs.readFile(path.join(root,'assets/quenching/index.html'),'utf8');
  assert(!html.includes(`Version ${release.displayVersion} TEST`));
  return {channel:'production',internalVersion:pkg.version,displayVersion:release.displayVersion,
    runtimeFilesChecked:files.length,testSelectionRemoved:true,offlineUiAndIpcRemoved:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(await checkProductionBuild()));
