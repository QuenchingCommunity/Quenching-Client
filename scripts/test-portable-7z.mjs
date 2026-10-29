import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createPortable7z, run7z } from './lib/portable-7z.mjs';
const parent=path.resolve('_tmp/client-portable-7z');await fs.mkdir(parent,{recursive:true});
const task=await fs.mkdtemp(path.join(parent,'test-'));
try {
  const source=path.join(task,'original'),output=path.join(task,'client.7z');
  await fs.mkdir(path.join(source,'resources'),{recursive:true});
  const bytes=Buffer.from('淬火客户端\n'.repeat(20));
  await fs.writeFile(path.join(source,'resources/中文.txt'),bytes);
  const entries=await createPortable7z(source,output,'QMC TEST');
  assert(entries.includes('QMC TEST/resources/中文.txt'));
  const chunks=[];
  await run7z(['x','-so',output,'QMC TEST/resources/中文.txt'],{onData:b=>chunks.push(b)});
  assert.deepEqual(Buffer.concat(chunks),bytes);
  assert.deepEqual(await fs.readFile(path.join(source,'resources/中文.txt')),bytes,'source preserved');
  await assert.rejects(createPortable7z(source,output,'QMC TEST'),/already exists/);
  await assert.rejects(createPortable7z(source,path.join(task,'bad.zip'),'QMC'),/\.7z/);
  await assert.rejects(createPortable7z(source,path.join(task,'bad.7z'),'../bad'),/Invalid archive root/);
  const single=path.join(task,'app.tar');await fs.writeFile(single,bytes);
  await createPortable7z(single,path.join(task,'app.tar.7z'),'app.tar');
  console.log('PASS: native 7z compression, root rename, Unicode paths, CRC, extracted bytes, source preservation and output guards');
} finally {
  assert.equal(path.dirname(task),parent);
  await fs.rm(task,{recursive:true,force:true});
}
