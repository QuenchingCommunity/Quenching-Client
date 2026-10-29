import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import JSZip from 'jszip';
import { prepareBundledAssets } from '../src/Main/services/bundled-assets';
import { extractZipArchive } from '../src/Main/services/zip-extraction';
import { withShaderBundle, selectShaderBundleResources } from '../src/Main/services/shader-bundle';
import { applyShaderToggles } from '../src/Main/services/fog-shader-override';
import { resourcePath } from '../src/shared/bundled-resource-paths.mjs';

const parent = path.resolve('_tmp/resource-bundle-20261028'); await fs.ensureDir(parent);
const root = await fs.mkdtemp(path.join(parent, 'real-'));
const assets = path.resolve('assets'), q = path.join(assets, 'quenching');
const manifest = await fs.readJson(path.join(q, 'resources.manifest.json'));
const options = { cacheBase: path.join(root, 'cache'), required: true };
try {
  const start = performance.now();
  const cache = (await prepareBundledAssets(assets, { ...options, selections: [] }))!;
  assert.deepEqual(await fs.readdir(cache), [], 'Opening the client does not expand game resources');
  const metadataMs = performance.now() - start;
  await extractZipArchive(path.join(q, 'zip-ui-20.zip'), path.join(root, 'ui'), {
    mapFile: name => name === 'ui-que/framedef/ui/inventorybar.fdf' ? name : null,
  });
  assert.deepEqual(await fs.readFile(path.join(root, 'ui/ui-que/framedef/ui/inventorybar.fdf')),
    await fs.readFile(path.resolve('assets/unpacked/packages/zip-ui-20/ui-que/framedef/ui/inventorybar.fdf')));
  assert(!await fs.pathExists(path.join(cache, 'packages/zip-ui-pub')));
  assert(!await fs.pathExists(path.join(cache, 'shaders')));
  const profile = { graphics: 'hd', shaderPack: 'shaders-300-hd' } as const;
  const settings = { lighting: 'standard', hdr: true, postProcessing: false, postProcessingGlow: false, objectShader: false };
  await withShaderBundle(q, profile.shaderPack, root, selected => applyShaderToggles(path.join(root, 'shaders'), selected, profile, settings),
    selectShaderBundleResources(profile, settings, []));
  assert(await fs.pathExists(path.join(root, 'shaders/ps/tonemap.bls')));
  assert(!await fs.pathExists(path.join(cache, 'shaders/shaders203')));
  assert(!await fs.pathExists(path.join(cache, 'shaders/shaders-300-hd/vs')));
  const legacy = ['shaders/shaders-300-legacy-hd', 'shaders/shaders-300-legacy-de', 'shaders/fog_shaders-legacy'];
  await prepareBundledAssets(assets, { ...options, selections: legacy });
  const originalPath = await fs.pathExists(path.join(q, 'shaders-300-legacy.zip')) ? path.join(q, 'shaders-300-legacy.zip')
    : path.join(parent, 'previous-quenching/shaders-300-legacy.zip');
  const original = await JSZip.loadAsync(await fs.readFile(originalPath), { checkCRC32: true });
  let legacyFiles = 0;
  for (const entry of Object.values(original.files)) if (!entry.dir) {
    assert.deepEqual(await fs.readFile(resourcePath(q, entry.name)), await entry.async('nodebuffer'), entry.name);
    legacyFiles++;
  }
  const warm = performance.now(); await prepareBundledAssets(assets, { ...options, selections: legacy });
  const warmLegacyMs=Math.round(performance.now()-warm);
  const foliagePrefix='packages/zip-foliage-que/';
  const foliageMembers=['resources-foliage-color.7z','resources-foliage-detail.7z'].map(archive=>
    Object.entries(manifest.files).filter(([name,record]:any)=>name.startsWith(foliagePrefix) && record.archive===archive)
      .sort((a:any,b:any)=>a[1].size-b[1].size)[0][0]);
  const foliageOutput=path.join(root,'foliage');
  await extractZipArchive(path.join(q,'zip-foliage-que.zip'),foliageOutput,{
    mapFile:name=>foliageMembers.includes(foliagePrefix+name)?name:null,
  });
  for(const member of foliageMembers)assert.deepEqual(await fs.readFile(path.join(foliageOutput,member.slice(foliagePrefix.length))),
    await fs.readFile(path.resolve('assets/unpacked',member)),'logical foliage group spans both independent archives');
  const state = await fs.readJson(path.join(cache, '.ready.json'));
  const report = { metadataOnlyMs: Math.round(metadataMs), warmLegacyMs,
    bundledFiles: Object.keys(manifest.files).length, bundledSourceBytes: Object.values(manifest.files).reduce((n: number, f: any) => n + f.size, 0),
    archiveBytes: Object.values(manifest.archives).reduce((n: number,a: any)=>n+a.size,0), cachedFiles: Object.keys(state.files).length,
    cachedBytes: Object.values(state.files).reduce((n: number, f: any) => n + f.size, 0), legacyFilesVerified: legacyFiles,
    uiAndHdrWereSelective: true, foliageCrossArchiveVerified: true, bootstrapIconPreserved: await fs.pathExists(path.join(q, '1.ico')) };
  await fs.writeJson(path.join(parent, 'real-verification.json'), report, { spaces: 2 });
  console.log(JSON.stringify(report));
} finally { assert(path.dirname(root) === parent); await fs.remove(root); }
