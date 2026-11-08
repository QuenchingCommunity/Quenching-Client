import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createPortableZip} from './lib/portable-zip.mjs';
import {run7z} from './lib/portable-7z.mjs';
const parent=path.resolve('_tmp/zip-presets-20261108');await fs.mkdir(parent,{recursive:true});
const root=await fs.mkdtemp(path.join(parent,'zip-'));
try{
 const source=path.join(root,'original'),output=path.join(root,'client.zip');
 await fs.mkdir(path.join(source,'resources'),{recursive:true});
 const payload=Buffer.from('淬火 ZIP ✓\n'.repeat(100));await fs.writeFile(path.join(source,'resources/中文.txt'),payload);
 await fs.writeFile(path.join(source,'QMClient.exe'),Buffer.from('portable-fixture'));
 const entries=await createPortableZip(source,output,'QMC TEST');
 assert(entries.includes('QMC TEST/resources/中文.txt'));assert(entries.includes('QMC TEST/QMClient.exe'));
 assert.equal((await fs.readFile(output)).subarray(0,4).toString('hex'),'504b0304','real ZIP header');
 const chunks=[];await run7z(['x','-so',output,'QMC TEST/resources/中文.txt'],{onData:b=>chunks.push(b)});
 assert.deepEqual(Buffer.concat(chunks),payload);assert.deepEqual(await fs.readFile(path.join(source,'resources/中文.txt')),payload);
 await assert.rejects(createPortableZip(source,output,'QMC'),/already exists/);
 await assert.rejects(createPortableZip(source,path.join(root,'bad.7z'),'QMC'),/\.zip/);
 await assert.rejects(createPortableZip(source,path.join(root,'bad.zip'),'../QMC'),/Invalid archive root/);
 console.log('PASS: standard ZIP signature, Unicode paths, CRC, real extraction, source preservation and output guards');
}finally{assert.equal(path.dirname(root),parent);await fs.rm(root,{recursive:true,force:true});}
