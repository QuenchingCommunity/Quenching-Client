// Real version reader with branch-specific fixtures; no game or OS command runs.
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const parent=path.resolve('_tmp/war3-version');await fs.ensureDir(parent);const work=await fs.mkdtemp(path.join(parent,'battle-version-'));
const f={channel:'retail', exeReads:[] as string[], exeVersions:new Map<string,string>()};
(globalThis as any).__battleVersionFixture=f;
const compiled=await build({
  stdin:{contents:`export { detectWar3Version } from './src/Main/services/war3-version';
    export { resolveModProfile } from './src/Main/services/mod-profile';`,resolveDir:process.cwd(),loader:'ts'},
  bundle:true,platform:'node',format:'cjs',packages:'external',write:false,
  plugins:[{name:'version-fixture',setup(p){
    p.onResolve({filter:/\/game-channel$|^child_process$/},a=>a.path.includes('shared/')?undefined:({path:a.path,namespace:'fixture'}));
    p.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='child_process'
      ? `const f=globalThis.__battleVersionFixture;
         export const execFile=(command,args,options,callback)=>{
           const exe=options.env.QUENCHING_VERSION_EXE;
           f.exeReads.push(exe);
           setImmediate(()=>callback(null,{stdout:f.exeVersions.get(exe)||''}));
         };`
      : 'const f=globalThis.__battleVersionFixture;export const getSelectedGameChannel=()=>f.channel,getSelectedGameFolder=()=>f.channel==="ptr"?"_ptr_":"_retail_";'}));
  }}],
});
const module={exports:{} as any};new Function('require','module','exports',compiled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
try {
  const rootInfo=path.join(work,'.build.info');
  await fs.writeFile(rootInfo,'Active!DEC:1|Version!STRING:0|Product!STRING:0\n1|3.0.0.24268|w3\n1|2.0.4.24000|w3t\n');
  f.channel='retail';assert.equal((await module.exports.detectWar3Version(work)).version,'3.0.0.24268');
  f.channel='ptr';assert.equal((await module.exports.detectWar3Version(work)).version,'2.0.4.24000');
  await fs.writeFile(rootInfo,'Active!DEC:1|Version!STRING:0|Product!STRING:0\n1|3.0.0.24268|w3\n1|3.0.1.24323|w3t\n');
  assert.equal((await module.exports.detectWar3Version(work)).version,'3.0.1.24323');
  await fs.writeFile(rootInfo,'Active!DEC:1|Version!STRING:0\n1|3.0.0.24268\n');
  assert.equal((await module.exports.detectWar3Version(work)).source,'unknown','PTR cannot borrow an unidentified root Retail version');
  await fs.outputFile(path.join(work,'_ptr_/.build.info'),'Active!DEC:1|Version!STRING:0\n1|3.0.2.24400\n');
  assert.equal((await module.exports.detectWar3Version(work)).version,'3.0.2.24400','local branch manifest still supports older formats');

  if (process.platform === 'win32') {
    const { detectWar3Version, resolveModProfile } = module.exports;
    const retail = path.join(work, '_retail_');
    const exe = path.join(retail, 'x86_64', 'Warcraft III.exe');
    await fs.outputFile(exe, 'version fixture');
    f.exeVersions.set(exe, '3.0.1.24371');
    f.channel = 'retail';
    const [detected, profile] = await Promise.all([detectWar3Version(exe), resolveModProfile(work)]);
    assert.deepEqual(detected, { version: '3.0.1.24371', parts: [3, 0, 1, 24371], source: 'exe' });
    assert.equal(profile.shaderPack, 'shaders-300-hd', 'stale 3.0 metadata must not select the legacy pack');
    assert.deepEqual(f.exeReads, [exe], 'concurrent detection and profile resolution share one probe');
    assert.equal((await detectWar3Version(work, 'ptr')).version, '3.0.2.24400', 'PTR cannot borrow the Retail executable');

    await fs.writeFile(rootInfo, 'Active!DEC:1|Version!STRING:0|Product!STRING:0\n1|3.0.1.24371|w3\n');
    f.exeVersions.set(exe, '3.0.0.24268');
    await fs.appendFile(exe, ' replaced');
    assert.equal((await resolveModProfile(work)).shaderPack, 'shaders-300-legacy-hd', 'genuine 3.0 still uses its own shaders');
    assert.deepEqual(f.exeReads, [exe, exe], 'replaced executable invalidates the version cache');

    f.exeVersions.delete(exe);
    await fs.appendFile(exe, ' unreadable');
    assert.deepEqual(await detectWar3Version(work), { version: '3.0.1.24371', parts: [3, 0, 1, 24371], source: 'build.info' });
  }
  console.log('PASS: branch-specific metadata and executable versions, stale manifest, auto shader selection, probe reuse and refresh');
} finally {delete (globalThis as any).__battleVersionFixture;if(path.dirname(work)!==parent||!path.basename(work).startsWith('battle-version-'))throw Error('unsafe fixture cleanup');await fs.remove(work);}
