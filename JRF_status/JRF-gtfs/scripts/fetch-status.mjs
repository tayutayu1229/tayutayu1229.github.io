import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const STATUS_MIRROR = 'https://tayunet-traininfo.com/JRF_status/index.html';
const OFFICIAL_SOURCE = 'https://www.jrfreight.co.jp/i_daiya.html';
const output = fileURLToPath(new URL('../data/freight-status.json', import.meta.url));
const strip = value => decode(value.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());
const decode = value => value.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ');
const all = (html, pattern) => [...html.matchAll(pattern)].map(match=>match.slice(1));

function parseStatus(html){
  const hero=html.match(/<div class="hero-meta">([\s\S]*?)<\/div>/)?.[1]||'',pills=all(hero,/<span class="pill">([\s\S]*?)<\/span>/g).map(x=>strip(x[0]));
  const summary=html.match(/<section class="summary">([\s\S]*?)<\/section>/)?.[1]||'',title=strip(summary.match(/<h2>([\s\S]*?)<\/h2>/)?.[1]||'公式輸送情報');
  const incidents=all(summary,/<li>\s*<time>([\s\S]*?)<\/time>\s*<p>([\s\S]*?)<\/p>\s*<\/li>/g).map(([time,detail])=>({time:strip(time),detail:strip(detail)})),routes=[];
  for(const match of html.matchAll(/<section class="route">([\s\S]*?)<\/section>/g)){const section=match[1],name=strip(section.match(/<h2>([\s\S]*?)<\/h2>/)?.[1]||'線区未分類'),trains=[];for(const row of section.matchAll(/<tr>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g))trains.push({service:strip(row[1]),location:strip(row[2]),status:strip(row[3]),route:name});if(trains.length)routes.push({name,trains});}
  const trains=routes.flatMap(route=>route.trains);if(!pills.length&&!trains.length&&!incidents.length)throw new Error('輸送状況ページの形式を認識できませんでした');
  return {ok:true,announcementDate:pills[0]?.replace(/^公式発表\s*/,'')||'',asOf:pills[1]||'',title,incidents,routes,trains,fetchedLabel:strip(html.match(/最終取得:\s*([^<]+)</)?.[1]||''),source:OFFICIAL_SOURCE,mirror:STATUS_MIRROR,proxiedAt:new Date().toISOString()};
}

try{
  const response=await fetch(STATUS_MIRROR,{headers:{'user-agent':'CargoScope-GitHub-Actions/1.0','accept':'text/html'},signal:AbortSignal.timeout(20000),cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const data=parseStatus(await response.text());await mkdir(new URL('../data/',import.meta.url),{recursive:true});await writeFile(output,JSON.stringify(data,null,2)+'\n');console.log(`Updated freight status: ${data.trains.length} trains / ${data.routes.length} routes (${data.asOf})`);
}catch(error){
  console.error(`Failed to update freight status: ${error.message}`);process.exitCode=1;
}
