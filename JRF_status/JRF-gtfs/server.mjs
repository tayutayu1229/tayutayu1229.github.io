import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const STATUS_MIRROR = 'https://tayunet-traininfo.com/JRF_status/index.html';
const OFFICIAL_SOURCE = 'https://www.jrfreight.co.jp/i_daiya.html';
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8'};

const strip = value => decode(value.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());
function decode(value){return value.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ');}
function all(html, pattern){return [...html.matchAll(pattern)].map(match=>match.slice(1));}

function parseStatus(html){
  const hero = html.match(/<div class="hero-meta">([\s\S]*?)<\/div>/)?.[1] || '';
  const pills = all(hero, /<span class="pill">([\s\S]*?)<\/span>/g).map(x=>strip(x[0]));
  const summary = html.match(/<section class="summary">([\s\S]*?)<\/section>/)?.[1] || '';
  const title = strip(summary.match(/<h2>([\s\S]*?)<\/h2>/)?.[1] || '公式輸送情報');
  const incidents = all(summary, /<li>\s*<time>([\s\S]*?)<\/time>\s*<p>([\s\S]*?)<\/p>\s*<\/li>/g).map(([time,detail])=>({time:strip(time),detail:strip(detail)}));
  const routes = [];
  for(const match of html.matchAll(/<section class="route">([\s\S]*?)<\/section>/g)){
    const section = match[1], name=strip(section.match(/<h2>([\s\S]*?)<\/h2>/)?.[1] || '線区未分類'), trains=[];
    for(const row of section.matchAll(/<tr>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g))trains.push({service:strip(row[1]),location:strip(row[2]),status:strip(row[3]),route:name});
    if(trains.length)routes.push({name,trains});
  }
  const fetchedLabel=strip(html.match(/最終取得:\s*([^<]+)</)?.[1] || '');
  const trains=routes.flatMap(route=>route.trains);
  if(!pills.length&&!trains.length&&!incidents.length)throw new Error('輸送状況ページの形式を認識できませんでした');
  return {ok:true,announcementDate:pills[0]?.replace(/^公式発表\s*/, '')||'',asOf:pills[1]||'',title,incidents,routes,trains,fetchedLabel,source:OFFICIAL_SOURCE,mirror:STATUS_MIRROR,proxiedAt:new Date().toISOString()};
}

async function freightStatus(){
  const response=await fetch(STATUS_MIRROR,{headers:{'user-agent':'CargoScope/1.0 (+local operations viewer)','accept':'text/html'},signal:AbortSignal.timeout(12000),cache:'no-store'});
  if(!response.ok)throw new Error(`輸送状況サーバー HTTP ${response.status}`);
  return parseStatus(await response.text());
}

const server=createServer(async(req,res)=>{
  try{
    if(['/api/freight-status','/data/freight-status.json'].includes(req.url?.split('?')[0])){
      try{const data=await freightStatus();res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));}
      catch(error){res.writeHead(502,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({ok:false,error:error.message,source:OFFICIAL_SOURCE,mirror:STATUS_MIRROR,proxiedAt:new Date().toISOString()}));}
      return;
    }
    const pathname=decodeURIComponent((req.url||'/').split('?')[0]);let file=normalize(join(ROOT,pathname==='/'?'index.html':pathname));
    if(!file.startsWith(ROOT)){res.writeHead(403);res.end('Forbidden');return;}
    const info=await stat(file);if(info.isDirectory())file=join(file,'index.html');const body=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream','cache-control':extname(file)==='.json'?'public, max-age=300':'no-cache'});res.end(body);
  }catch(error){res.writeHead(error.code==='ENOENT'?404:500,{'content-type':'text/plain; charset=utf-8'});res.end(error.code==='ENOENT'?'Not found':error.message);}
});
server.listen(PORT,'127.0.0.1',()=>console.log(`Cargo Scope: http://localhost:${PORT}`));
