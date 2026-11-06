// Local signed-update transport. Bind only loopback and expose explicit artifacts.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pipeline} from 'node:stream/promises';

const release=path.resolve(process.argv[2] || '');
if(!process.argv[2])throw Error('Usage: node scripts/serve-update-test.mjs RELEASE_DIR');
const config=JSON.parse(await fs.readFile(path.join(release,'local-server.json')));
const base=new URL(config.baseUrl);
if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||base.search||base.hash||!base.pathname.startsWith('/quenching/update-test/')||!base.pathname.endsWith('/'))throw Error('Expected an isolated loopback TEST URL');
const routes=new Map(Object.entries(config.routes));
const recent=[];let totalBytes=0;
const server=http.createServer(async(req,res)=>{
  try{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
    const url=new URL(req.url,base.origin);
    if(url.pathname===base.pathname){
      res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
      res.end(`Quenching TEST update service\n${config.description}\n${config.baseUrl}\nRequests: ${recent.length}; bytes served: ${totalBytes}\nThis service runs only on this computer.\n`);return;
    }
    if(url.pathname===base.pathname+'_status'){
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({pid:process.pid,totalBytes,recent}));return;
    }
    const relative=routes.get(url.pathname);
    if(!relative){res.writeHead(404).end('Not found');return;}
    const file=path.resolve(release,relative);
    if(!file.startsWith(release+path.sep))throw Error('Artifact outside release');
    // Reject links in every component, not just the final file.
    let checked=release;
    for(const component of path.relative(release,file).split(path.sep)){checked=path.join(checked,component);if((await fs.lstat(checked)).isSymbolicLink())throw Error('Artifact link');}
    const stat=await fs.stat(file);if(!stat.isFile())throw Error('Not a file');
    res.writeHead(200,{'Content-Length':stat.size,'Cache-Control':'no-store','Content-Type':file.endsWith('.json')?'application/json':file.endsWith('.que')?'application/json':file.endsWith('.gz')?'application/gzip':'application/octet-stream'});
    const event={at:new Date().toISOString(),path:url.pathname,method:req.method,bytes:req.method==='HEAD'?0:stat.size,completed:false};
    recent.push(event);if(recent.length>500)recent.shift();
    if(req.method==='HEAD'){res.end();event.completed=true;return;}
    await pipeline(fss.createReadStream(file),res);event.completed=true;totalBytes+=stat.size;
  }catch(error){if(!res.headersSent)res.writeHead(500);res.end();console.error(String(error.message).slice(0,400));}
});
server.listen(Number(base.port),'127.0.0.1',()=>console.log(JSON.stringify({ready:true,pid:process.pid,baseUrl:config.baseUrl,routes:routes.size})));
