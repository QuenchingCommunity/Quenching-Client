import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import {VISION_MODULES,visionModuleFor,visionBlocksSetting} from '../src/shared/vision-modules';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const registration = { fail: false, channels: [] as string[] };
(globalThis as any).__visionRegistration = registration;
const compiled=await build({entryPoints:['src/Main/services/vision-modules.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'fixture-branch',setup(b){
  b.onResolve({filter:/^\.\/(game-channel|local-files-service)$/},args=>({path:args.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.endsWith('local-files-service')
    ? 'export const ensureLocalFiles=async channel=>{const f=globalThis.__visionRegistration;f.channels.push(channel);if(f.fail)throw Error("local files blocked");};'
    : "export const getSelectedGameFolder=()=> '_retail_';export const getSelectedGameChannel=()=> 'retail';export const getChannelModEnabled=()=>true;",loader:'ts'}));
}}]});
const loaded={exports:{} as any};new Function('require','module','exports',compiled.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports);
const {setVisionModule,getVisionModules,assertVisionSettingAllowed,visionRequiresWarcraft30,restoreIncompatibleVisionModules}=loaded.exports;

const parent=path.resolve('_tmp/vision-modules-20261105');await fs.ensureDir(parent);
const root=await fs.mkdtemp(path.join(parent,'test-')),source=path.join(root,'source'),game=path.join(root,'game'),branch=path.join(game,'_retail_');
const originalRename=fs.rename;
try{
  const original={'units/unitskin.txt':'our unit table','units/destructableskin.txt':'our tree table','units/hero.mdx':'our model',
    'COS/custom.mdx':'our skin','environment/dnc/unit.mdx':'our light','environment/foliage/our.dds':'our foliage',
    'terrainart/terrain.slk':'our terrain','doodads/our.mdx':'our doodad','replaceabletextures/our.dds':'our replacement','ui/test.fdf':'our ui','ui/quenching-only.fdf':'quenching only'};
  const incoming={'units/unitskin.txt':'NEVER INSTALL','units/destructableskin.txt':'NEVER INSTALL','units/hero.mdx':'vm model','buildings/tower.mdx':'vm tower',
    'environment/dnc/unit.mdx':'NEVER INSTALL','environment/foliage/vm.dds':'vm foliage','terrainart/terrain.slk':'vm terrain',
    'doodads/vm.mdx':'vm doodad','replaceabletextures/vm.dds':'vm replacement','ui/test.fdf':'vm ui','sound/test.flac':'vm sound',
    '_tilesets/l.w3mod/terrainart/tiles.dds':'vm terrain tile'};
  for(const [name,text] of Object.entries(original))await fs.outputFile(path.join(branch,name),text);
  for(const [name,text] of Object.entries(incoming))await fs.outputFile(path.join(source,'_retail_',name),text);
  const writeGameVersion = (version: string) => fs.outputFile(path.join(branch, '.build.info'), `Active!DEC:1|Version!STRING:0\n1|${version}\n`);
  await writeGameVersion('3.0.1.24371');
  registration.fail = true;
  await assert.rejects(setVisionModule(branch,source,'visionUnits',true),/local files blocked/);
  assert.equal((await getVisionModules(branch)).visionUnits,false);
  assert.equal(await fs.readFile(path.join(branch,'units/hero.mdx'),'utf8'),'our model');
  registration.fail = false;
  assert.equal(visionModuleFor('_tilesets/l.w3mod/terrainart/tiles.dds'),'visionTerrain');
  for(const file of ['units/unitskin.txt','units/unitsskin.txt','units/destructableskin.txt','buildings/config.TXT','environment/dnc/unit.mdx','env/dnc/terrain.mdx','../outside','COS/custom.mdx'])assert.equal(visionModuleFor(file),null,file);
  // Every combination, in both enable/disable orders, retains independent tables and skins.
  for(let mask=0;mask<16;mask++){
    for(const [i,module] of VISION_MODULES.entries())if(mask&(1<<i))await setVisionModule(game,source,module,true);
    const modules=await getVisionModules(game);
    assert.equal(await fs.readFile(path.join(branch,'units/unitskin.txt'),'utf8'),'our unit table');
    assert.equal(await fs.readFile(path.join(branch,'COS/custom.mdx'),'utf8'),'our skin');
    assert.equal(await fs.readFile(path.join(branch,'environment/dnc/unit.mdx'),'utf8'),'our light');
    assert.equal(await fs.pathExists(path.join(branch,'units/destructableskin.txt')),!modules.visionDecorations);
    if(modules.visionTerrain){assert(!await fs.pathExists(path.join(branch,'environment/foliage/our.dds')));await assert.rejects(assertVisionSettingAllowed(game,'terrain'),/接管/);}
    assert(!visionBlocksSetting(modules,'skinSelections'));
    if(modules.visionMisc){assert(!await fs.pathExists(path.join(branch,'ui/quenching-only.fdf')));assert(modules.visionMiscUI);assert(!modules.visionMiscShaders);assert(!visionBlocksSetting(modules,'lighting'));}
    for(const module of [...VISION_MODULES].reverse())await setVisionModule(game,'',module,false);
    for(const [name,text] of Object.entries(original))assert.equal(await fs.readFile(path.join(branch,name),'utf8'),text,name);
    assert(!await fs.pathExists(path.join(branch,'buildings/tower.mdx')));
  }
  await setVisionModule(game,source,'visionUnits',true);
  original['units/unitskin.txt']='new skin selection';original['COS/custom.mdx']='new chosen skin';
  await fs.writeFile(path.join(branch,'units/unitskin.txt'),original['units/unitskin.txt']);
  await fs.writeFile(path.join(branch,'COS/custom.mdx'),original['COS/custom.mdx']);
  await setVisionModule(game,'','visionUnits',false);
  assert.equal(await fs.readFile(path.join(branch,'units/unitskin.txt'),'utf8'),'new skin selection');
  assert.equal(await fs.readFile(path.join(branch,'COS/custom.mdx'),'utf8'),'new chosen skin');
  let failed=false;
  fs.rename=(async(from:string,to:string)=>{
    if(!failed&&from.includes(`${path.sep}prepared${path.sep}`)){failed=true;throw Error('injected Vision copy failure');}
    return originalRename(from,to);
  }) as typeof fs.rename;
  try{await assert.rejects(setVisionModule(game,source,'visionUnits',true),/injected/);}finally{fs.rename=originalRename;}
  assert.equal((await getVisionModules(game)).visionUnits,false);
  for(const [name,text] of Object.entries(original))assert.equal(await fs.readFile(path.join(branch,name),'utf8'),text);
  assert.deepEqual(await fs.readdir(path.join(branch,'_tmp')),[]);
  await assert.rejects(setVisionModule(game,branch,'visionUnits',true),/游戏目录/);
  const incomingModel = path.join(source, '_retail_', 'units/hero.mdx');
  const mdx = Buffer.alloc(16);
  mdx.write('MDLXVERS');
  mdx.writeUInt32LE(4, 8);
  mdx.writeUInt32LE(1800, 12);
  await fs.writeFile(incomingModel, mdx);
  assert.equal(await visionRequiresWarcraft30(game, source), false);
  await setVisionModule(game, source, 'visionUnits', true);
  await setVisionModule(game, source, 'visionTerrain', true);
  await writeGameVersion('2.0.4.23745');
  assert.equal(await visionRequiresWarcraft30(game, source), true);
  await fs.unlink(incomingModel);
  await restoreIncompatibleVisionModules(game);
  assert.equal((await getVisionModules(game)).visionUnits, false);
  assert.equal((await getVisionModules(game)).visionTerrain, false);
  assert.equal(await fs.readFile(path.join(branch, 'units/hero.mdx'), 'utf8'), original['units/hero.mdx']);
  assert.equal(await fs.readFile(path.join(branch, 'units/unitskin.txt'), 'utf8'), original['units/unitskin.txt']);
  await fs.writeFile(incomingModel, mdx);
  for (const module of VISION_MODULES) await assert.rejects(setVisionModule(game, source, module, true), /2\.04/);
  mdx.writeUInt32LE(1200, 12);
  await fs.writeFile(incomingModel, mdx);
  assert.equal(await visionRequiresWarcraft30(game, source), false);
  await setVisionModule(game, source, 'visionUnits', true);
  await restoreIncompatibleVisionModules(game);
  assert.equal((await getVisionModules(game)).visionUnits, true);
  await setVisionModule(game, '', 'visionUnits', false);
  await fs.writeFile(incomingModel, incoming['units/hero.mdx']);
  await writeGameVersion('3.0.1.24371');
  await fs.outputJson(path.join(branch,'_QMThirdParty.json'),{slots:[{enabled:true}]});
  await assert.rejects(setVisionModule(game,source,'visionUnits',true),/其他第三方/);
  if (process.argv[2]) {
    const archiveSource = path.resolve(process.argv[2]);
    await fs.unlink(path.join(branch, '_QMThirdParty.json'));
    await writeGameVersion('2.0.4.23745');
    assert.equal(await visionRequiresWarcraft30(game, archiveSource), true);
    await assert.rejects(setVisionModule(game, archiveSource, 'visionUnits', true), /2\.04/);
    await writeGameVersion('3.0.1.24371');
    for (const module of VISION_MODULES) await setVisionModule(game, archiveSource, module, true);
    const state = await fs.readJson(path.join(branch, '.quenching-vision-modules.json'));
    for (const module of VISION_MODULES) {
      assert(state[module].files.length > 0, module);
      for (const file of state[module].files) {
        assert.deepEqual(await fs.readFile(path.join(branch, file)), await fs.readFile(path.join(archiveSource, '_retail_', file)));
      }
    }
    for (const module of [...VISION_MODULES].reverse()) await setVisionModule(game, '', module, false);
    for (const [file, content] of Object.entries(original)) assert.equal(await fs.readFile(path.join(branch, file), 'utf8'), content, file);
    console.log('PASS: real Vision Mod v3.0 archive samples deploy and restore for all four modules');
  }
  console.log('PASS: all 16 module combinations, unit TXT/COS/DNC preservation, whole folder replacement, independent restore, conflict gates, failed-write rollback and generic-slot exclusion.');
}finally{delete (globalThis as any).__visionRegistration;fs.rename=originalRename;assert.equal(path.dirname(root),parent);await fs.remove(root);}
