import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
const [releaseArg,clientArg]=process.argv.slice(2);
if(!releaseArg||!clientArg)throw Error('Usage: node scripts/launch-local-update-test.mjs RELEASE_DIR CLIENT_DIR [--check]');
const release=path.resolve(releaseArg),client=path.resolve(clientArg);
const config=JSON.parse(await fs.readFile(path.join(release,'local-server.json')));
const marker=JSON.parse(await fs.readFile(path.join(client,'quenching-update-test.json')));
if(marker.schema!==1||marker.enabled!==true||marker.baseUrl!==config.baseUrl)throw Error('Client does not select this TEST channel');
const local=await fs.readFile(path.join(release,'site/client-manifests/latest.json'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function ready(){try{const res=await fetch(new URL('client-manifests/latest.json',config.baseUrl),{signal:AbortSignal.timeout(2000)});if(!res.ok)return false;if(hash(Buffer.from(await res.arrayBuffer()))!==hash(local))throw Error('A different candidate occupies the TEST address');return true;}catch(error){if(error.message.includes('different candidate'))throw error;return false;}}
if(!await ready()){
 const processInfo=spawn(process.execPath,[path.join(import.meta.dirname,'serve-update-test.mjs'),release],{cwd:path.dirname(import.meta.dirname),detached:true,windowsHide:true,stdio:'ignore'});
 processInfo.unref();for(let i=0;i<40&&!await ready();i++)await pause(250);
 if(!await ready())throw Error('TEST service could not start');
}
if(!process.argv.includes('--check')){
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('QUENCHING_')||key==='ELECTRON_RUN_AS_NODE')delete env[key];
 const app=spawn(path.join(client,'QMClient.exe'),[],{cwd:client,env,detached:true,windowsHide:false,stdio:'ignore'});app.unref();
}
console.log(JSON.stringify({ready:true,client,baseUrl:config.baseUrl,launched:!process.argv.includes('--check')}));
