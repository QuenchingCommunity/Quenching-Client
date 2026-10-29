// Real version reader with branch-specific fixtures; no game or OS command runs.
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const parent=path.resolve('_irys/work');await fs.ensureDir(parent);const work=await fs.mkdtemp(path.join(parent,'battle-version-'));
const f={channel:'retail'};(globalThis as any).__battleVersionFixture=f;
const compiled=await build({entryPoints:['src/Main/services/war3-version.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,
  plugins:[{name:'selected-branch',setup(p){p.onResolve({filter:/\/game-channel$/},a=>a.path.includes('shared/')?undefined:({path:a.path,namespace:'fixture'}));p.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'const f=globalThis.__battleVersionFixture;export const getSelectedGameChannel=()=>f.channel,getSelectedGameFolder=()=>f.channel==="ptr"?"_ptr_":"_retail_";'}));}}],
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
  console.log('PASS: shared build.info selects w3/w3t independently; wrong branch never enables 3.0; unknown/legacy branch metadata behavior');
} finally {delete (globalThis as any).__battleVersionFixture;if(path.dirname(work)!==parent||!path.basename(work).startsWith('battle-version-'))throw Error('unsafe fixture cleanup');await fs.remove(work);}
