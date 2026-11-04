import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const OFFICIAL_SOURCE = 'https://www.jrfreight.co.jp/i_daiya.html';
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8'};

// Serve the same validated snapshot as Pages; update via npm run fetch-status.
async function freightStatus(){
  return JSON.parse(await readFile(join(ROOT, 'data/freight-status.json'), 'utf8'));
}

const server=createServer(async(req,res)=>{
  try{
    if(['/api/freight-status','/data/freight-status.json'].includes(req.url?.split('?')[0])){
      try{const data=await freightStatus();res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));}
      catch(error){res.writeHead(502,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({ok:false,error:error.message,source:OFFICIAL_SOURCE}));}
      return;
    }
    const pathname=decodeURIComponent((req.url||'/').split('?')[0]);
    const staticRoot=pathname.startsWith('/assets/')?fileURLToPath(new URL('../../',import.meta.url)):ROOT;
    let file=normalize(join(staticRoot,pathname==='/'?'index.html':pathname));
    if(!file.startsWith(staticRoot)){res.writeHead(403);res.end('Forbidden');return;}
    const info=await stat(file);if(info.isDirectory())file=join(file,'index.html');const body=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream','cache-control':extname(file)==='.json'?'public, max-age=300':'no-cache'});res.end(body);
  }catch(error){res.writeHead(error.code==='ENOENT'?404:500,{'content-type':'text/plain; charset=utf-8'});res.end(error.code==='ENOENT'?'Not found':error.message);}
});
server.listen(PORT,'127.0.0.1',()=>console.log(`Cargo Scope: http://localhost:${PORT}`));
