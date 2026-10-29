import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareResourceBundle } from './prepare-resource-bundle.mjs';
import { prepareBundledAssets } from '../src/Main/services/bundled-assets';
import { UNPACKED_RESOURCE_DIRS, RESOURCE_ARCHIVES, RESOURCE_MANIFEST, resourcePath } from '../src/shared/bundled-resource-paths.mjs';
import { extractZipArchive } from '../src/Main/services/zip-extraction';
import { enumerateClientModFiles } from '../src/Main/services/client-mod-files';

const parent = path.resolve('_tmp/resource-bundle-20261028');
await fs.ensureDir(parent);
const root = await fs.mkdtemp(path.join(parent, 'test-'));
const assets = path.join(root, 'assets');
const q = path.join(assets, 'quenching');
const source = path.join(assets, 'unpacked');
const cacheBase = path.join(root, 'cache');
const options = { cacheBase, required: true };
const rename = fs.rename;
try {
  for (const name of UNPACKED_RESOURCE_DIRS) await fs.outputFile(path.join(source, name, 'sample.bin'), `${name}-sample`);
  await fs.outputFile(path.join(source, 'not-requested/private.txt'), 'never include');
  await fs.outputFile(path.join(source, 'packages/fake-ui/directory/one.fdf'), 'selected-fdf');
  await fs.outputFile(path.join(source, 'packages/fake-ui/directory/other.fdf'), 'other-fdf');
  await fs.outputFile(path.join(source, 'shaders/shaders203/ps/a.bls'), 'shader-a');
  await fs.outputFile(path.join(source, 'shaders/shaders203/ps/b.bls'), 'shader-b');
  const built = await prepareResourceBundle(root, { requireLegacy: false });
  assert.equal(built.changed, true);
  const stamp = (await fs.stat(path.join(q, RESOURCE_ARCHIVES[0]))).mtimeMs;
  assert.equal((await prepareResourceBundle(root, { requireLegacy: false })).changed, false);
  assert.equal((await fs.stat(path.join(q, RESOURCE_ARCHIVES[0]))).mtimeMs, stamp);
  let manifest = await fs.readJson(path.join(q, RESOURCE_MANIFEST));
  assert.equal(Object.keys(manifest.files).length, 13);
  const hidden = path.join(root, 'hidden-source');
  await fs.rename(source, hidden);
  const empty = await prepareBundledAssets(assets, { ...options, selections: [] });
  assert(!await fs.pathExists(path.join(empty!, 'camp')), 'Metadata-only startup must not expand resources');
  const hold=path.join(root,'other-archives');await fs.ensureDir(hold);
  for(const name of RESOURCE_ARCHIVES.filter(name=>name!=='resources-ui.7z'))await fs.rename(path.join(q,name),path.join(hold,name));
  await prepareBundledAssets(assets,{...options,selections:['tx/sample.bin']});
  assert.equal(await fs.readFile(path.join(empty!,'tx/sample.bin'),'utf8'),'tx-sample','UI archive is usable without the other four archives');
  for(const name of RESOURCE_ARCHIVES.filter(name=>name!=='resources-ui.7z'))await fs.rename(path.join(hold,name),path.join(q,name));
  await fs.outputFile(path.join(q, 'fake-ui.zip'), 'stale archive left by a previous client');
  await extractZipArchive(path.join(q, 'fake-ui.zip'), path.join(root, 'ui-output'), {
    mapFile: name => name.endsWith('one.fdf') ? 'selected.fdf' : null,
  });
  assert.equal(await fs.readFile(path.join(root, 'ui-output/selected.fdf'), 'utf8'), 'selected-fdf');
  assert(!await fs.pathExists(path.join(empty!, 'packages/fake-ui/directory/other.fdf')), 'Only the selected 7z member is expanded');
  assert(!await fs.pathExists(path.join(empty!, 'shaders')), 'UI does not expand shader resources');
  await prepareBundledAssets(assets, { ...options, selections: ['shaders/shaders203/ps/a.bls'] });
  const game = path.join(root, 'ownership-game');
  await fs.outputFile(path.join(game, 'shaders/ps/a.bls'), 'shader-a');
  await fs.outputFile(path.join(game, 'shaders/ps/b.bls'), 'shader-b');
  const owned = await enumerateClientModFiles(game, false, q);
  assert(owned.includes('shaders/ps/b.bls'), 'Ownership uses full trusted metadata even with a partially expanded source');
  assert(!await fs.pathExists(path.join(empty!, 'shaders/shaders203/ps/b.bls')), 'Ownership inspection must not expand resources');
  const progress: number[] = [];
  const paths = await Promise.all([
    prepareBundledAssets(assets, { ...options, onProgress: p => progress.push(p) }),
    prepareBundledAssets(assets, options), prepareBundledAssets(assets, options),
  ]);
  const cached = paths[0]!;
  assert(paths.every(p => p === cached));
  assert.equal(progress.at(-1), 100);
  for (const name of UNPACKED_RESOURCE_DIRS) {
    assert.deepEqual(await fs.readFile(path.join(cached, name, 'sample.bin')), await fs.readFile(path.join(hidden, name, 'sample.bin')));
    assert.equal(resourcePath(q, name, 'sample.bin'), path.join(cached, name, 'sample.bin'));
  }
  assert.equal(resourcePath(q, 'zip-ui-pub.zip'), path.join(q, 'zip-ui-pub.zip'));
  const cachedStamp = (await fs.stat(path.join(cached, 'skin/sample.bin'))).mtimeMs;
  assert.equal(await prepareBundledAssets(assets, options), cached);
  assert.equal((await fs.stat(path.join(cached, 'skin/sample.bin'))).mtimeMs, cachedStamp, 'Warm start does not extract again');
  await fs.unlink(path.join(cached, 'skin/sample.bin'));
  await prepareBundledAssets(assets, options);
  assert.equal(await fs.readFile(path.join(cached, 'skin/sample.bin'), 'utf8'), 'skin-sample');

  const waterStamp = await fs.stat(path.join(cached, 'water/sample.bin'));
  await fs.writeFile(path.join(cached, 'water/sample.bin'), 'bad!-sample!');
  await fs.utimes(path.join(cached, 'water/sample.bin'), waterStamp.atime, waterStamp.mtime);
  let fail = true;
  fs.rename = (async (from: string, to: string) => {
    if (fail && from.includes(`${path.sep}prepared${path.sep}`) && to === path.join(cached, 'water/sample.bin')) { fail = false; throw new Error('injected cache publication failure'); }
    return rename(from, to);
  }) as typeof fs.rename;
  try { await assert.rejects(prepareBundledAssets(assets, options), /publication failure/); }
  finally { fs.rename = rename; }
  assert(await fs.pathExists(path.join(cached, '.ready.json')), 'Failed replacement restores prior cache');
  await prepareBundledAssets(assets, options);
  assert.equal(await fs.readFile(path.join(cached, 'water/sample.bin'), 'utf8'), 'water-sample');

  // Same-size/mtime source edits still invalidate the compressed archive.
  await fs.rename(hidden, source);
  const originalArchiveStats=await Promise.all(RESOURCE_ARCHIVES.map(async name=>({name,...await fs.stat(path.join(q,name))})));
  const originalArchiveHashes={...manifest.archives};
  const originalStat = await fs.stat(path.join(source, 'skin/sample.bin'));
  await fs.writeFile(path.join(source, 'skin/sample.bin'), 'skin-change');
  await fs.utimes(path.join(source, 'skin/sample.bin'), originalStat.atime, originalStat.mtime);
  await fs.unlink(path.join(source, 'not-requested/private.txt'));
  const incremental = await prepareResourceBundle(root, { requireLegacy: false });
  assert.equal(incremental.changed, true);
  assert.equal(incremental.recompressedFiles, 1, 'Only the changed member is recompressed');
  assert.equal(incremental.removedFiles, 1);
  assert.deepEqual(incremental.changedArchives,['resources-core.7z']);
  const nextManifest=await fs.readJson(path.join(q,RESOURCE_MANIFEST));
  for(const saved of originalArchiveStats.filter(a=>a.name!=='resources-core.7z')) {
    assert.deepEqual(nextManifest.archives[saved.name],originalArchiveHashes[saved.name]);
    assert.equal((await fs.stat(path.join(q,saved.name))).mtimeMs,saved.mtimeMs,'unchanged archive not rewritten');
  }
  const updated = await prepareBundledAssets(assets, options);
  assert.notEqual(updated, cached);
  assert.equal(await fs.readFile(path.join(updated!, 'skin/sample.bin'), 'utf8'), 'skin-change');
  assert.equal(await fs.readFile(path.join(cached, 'skin/sample.bin'), 'utf8'), 'skin-sample', 'Prior version remains available for rollback');

  const archive = await fs.readFile(path.join(q, RESOURCE_ARCHIVES[0]));
  const broken = Buffer.from(archive); broken[broken.length - 1] ^= 1;
  await fs.writeFile(path.join(q, RESOURCE_ARCHIVES[0]), broken);
  await assert.rejects(prepareBundledAssets(assets, options), /校验失败/);
  await prepareBundledAssets(assets,{...options,selections:['tx/sample.bin']});
  await fs.writeFile(path.join(q, RESOURCE_ARCHIVES[0]), archive);
  manifest = await fs.readJson(path.join(q, RESOURCE_MANIFEST));
  const legacyAssets=path.join(root,'legacy-assets'),legacyQ=path.join(legacyAssets,'quenching');await fs.ensureDir(legacyQ);
  const legacyFiles=Object.fromEntries(Object.entries(manifest.files).filter(([,r]:any)=>r.archive===RESOURCE_ARCHIVES[0])
    .map(([name,record]:any)=>[name,{size:record.size,sha256:record.sha256}]));
  const legacyManifest={schema:2,id:createHash('sha256').update(JSON.stringify({schema:2,files:legacyFiles})).digest('hex'),
    files:legacyFiles,packages:{},archive:{...manifest.archives[RESOURCE_ARCHIVES[0]],name:'resources.7z'}};
  await fs.copyFile(path.join(q,RESOURCE_ARCHIVES[0]),path.join(legacyQ,'resources.7z'));
  await fs.writeJson(path.join(legacyQ,RESOURCE_MANIFEST),legacyManifest);
  const legacyCache=await prepareBundledAssets(legacyAssets,{cacheBase:path.join(root,'legacy-cache'),required:true,selections:['skin/sample.bin']});
  assert.equal(await fs.readFile(path.join(legacyCache!,'skin/sample.bin'),'utf8'),'skin-change','schema 2 remains readable');
  const bad = structuredClone(manifest); bad.files['../escape.txt'] = Object.values(bad.files)[0];
  bad.id = createHash('sha256').update(JSON.stringify({ schema: 3, files: bad.files })).digest('hex');
  await fs.writeJson(path.join(q, RESOURCE_MANIFEST), bad);
  await assert.rejects(prepareBundledAssets(assets, options), /Invalid bundled-resource/);
  await fs.writeJson(path.join(q, RESOURCE_MANIFEST), manifest);
  const outside = path.join(root, 'outside'); await fs.ensureDir(outside);
  const linkedBase = path.join(root, 'linked-cache'); await fs.ensureDir(linkedBase);
  await fs.symlink(outside, path.join(linkedBase, 'unpacked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareBundledAssets(assets, { cacheBase: linkedBase, required: true }), /cannot be a link/);
  assert.deepEqual(await fs.readdir(outside), []);
  const previousCore=await fs.readFile(path.join(q,'resources-core.7z'));
  const previousMetadata=await fs.readFile(path.join(q,RESOURCE_MANIFEST));
  const uiArchive=path.join(q,'resources-ui.7z');
  await fs.rename(uiArchive,uiArchive+'.preserved');await fs.ensureDir(uiArchive);
  await fs.appendFile(path.join(source,'skin/sample.bin'),'publication-test');
  await fs.appendFile(path.join(source,'tx/sample.bin'),'publication-test');
  try {
    await assert.rejects(prepareResourceBundle(root,{requireLegacy:false}),/Invalid resource publication target/);
    assert.deepEqual(await fs.readFile(path.join(q,'resources-core.7z')),previousCore,'earlier published archive rolled back');
    assert.deepEqual(await fs.readFile(path.join(q,RESOURCE_MANIFEST)),previousMetadata,'manifest remains at original revision');
  } finally {await fs.rmdir(uiArchive);await fs.rename(uiArchive+'.preserved',uiArchive);}
  assert.equal(await prepareBundledAssets(assets, { ...options, preferLoose: true }), source);
  console.log('PASS: selective 7z build/reuse, metadata-only startup, per-file UI extraction, source changes, concurrent callers, warm cache, repair, rollback, version isolation, archive corruption, unsafe manifest/link rejection and loose development sources.');
} finally {
  fs.rename = rename;
  assert(path.dirname(root) === parent && !(await fs.lstat(root)).isSymbolicLink());
  await fs.remove(root);
}
