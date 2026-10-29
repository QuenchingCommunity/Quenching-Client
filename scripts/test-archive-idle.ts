import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import fs from 'fs-extra';
import { build } from 'esbuild';

const parent = path.resolve('_tmp/preset-timeout'); await fs.ensureDir(parent);
const root = await fs.mkdtemp(path.join(parent, 'archive-idle-'));
const fixture = { idle: true, killed: 0 };
(globalThis as any).__archiveIdleFixture = fixture;
const result = await build({ entryPoints: ['src/Main/services/archive-extraction.ts'], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'idle-worker', setup(api) {
    api.onResolve({ filter: /^node:child_process$/ }, () => ({ path: 'worker', namespace: 'fixture' }));
    api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream'),fs=require('node:fs'),path=require('node:path');
      const f=globalThis.__archiveIdleFixture;
      export const spawn=(_binary,args)=>{
        const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();let interval;
        child.kill=()=>{f.killed++;clearInterval(interval);setImmediate(()=>child.emit('close',-1));return true;};
        if(!f.idle){
          const listing=['Path = a.txt\\n','Size = 1\\n','Folder = -\\n','Attributes = A\\n','Encrypted = -\\n','Method = Copy\\n\\n'];
          if(args[0]==='x')fs.writeFileSync(path.join(args.find(a=>a.startsWith('-o')).slice(2),'a.txt'),'x');
          let n=0;
          interval=setInterval(()=>{child.stdout.write(args[0]==='l'?listing[n]:(n*10)+'%\\b');
            if(++n===listing.length){clearInterval(interval);child.emit('close',0);}},10);
        }
        return child;
      };` }));
  } }] });
const module = { exports: {} as any };
new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
try {
  const target = path.join(root, 'target'); await fs.outputFile(path.join(target, 'player.txt'), 'keep');
  await assert.rejects(module.exports.extractArchive('fixture.7z', target, { idleTimeoutMs: 25 }), /没有响应/);
  assert.equal(fixture.killed, 1, 'an idle worker is stopped before its operation rejects');
  assert.deepEqual(await fs.readdir(target), ['player.txt']);
  fixture.idle = false;
  assert.equal(await module.exports.extractArchive('fixture.7z', target, { idleTimeoutMs: 25 }), 1);
  assert.equal(fixture.killed, 1, 'continued progress renews the deadline even when total work exceeds it');
  assert.equal(await fs.readFile(path.join(target, 'a.txt'), 'utf8'), 'x');
  console.log('PASS: idle extraction stops the worker; active progress renews the timeout; existing files survive.');
} finally { await fs.remove(root); delete (globalThis as any).__archiveIdleFixture; }
