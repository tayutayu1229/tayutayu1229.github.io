const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const data={ok:true,trains:[],routes:[],incidents:[]};
let health={ok:true,checkedAt:new Date().toISOString()},mode='live',calls=[];
const window={};
vm.runInNewContext(fs.readFileSync('assets/js/freight-status-client.js','utf8'),{window,AbortController,setTimeout,clearTimeout,
 fetch:async(url,options)=>{
  calls.push(url);
  if(options.signal?.aborted)throw new Error('aborted');
  if(url.startsWith('https:')){
   if(mode==='offline')throw new Error('offline');
   return {ok:true,json:async()=>mode==='malformed'?{}:{data,health}};
  }
  return {ok:true,json:async()=>url.includes('fetch-health')?health:data};
 }});
(async()=>{
 let result=await window.TayunetFreightStatus.load();assert.equal(result.transport,'live');assert.equal(calls.length,1);
 health={ok:false,error:'official unavailable'};calls=[];
 result=await window.TayunetFreightStatus.load();assert.equal(result.health.ok,false);assert.equal(calls.length,1,'有効なライブ取得失敗を古い成功情報で隠さない');
 health={ok:true,available:false,reason:'outside_service_hours'};calls=[];
 result=await window.TayunetFreightStatus.load();assert.equal(result.health.available,false);assert.equal(result.transport,'live');
 mode='offline';calls=[];result=await window.TayunetFreightStatus.load();assert.equal(result.transport,'pages');assert.equal(calls.length,3);
 mode='malformed';result=await window.TayunetFreightStatus.load();assert.equal(result.transport,'pages');
 const controller=new AbortController();controller.abort();calls=[];
 await assert.rejects(window.TayunetFreightStatus.load({signal:controller.signal}));assert.equal(calls.length,1,'キャンセル時に代替取得を続けない');
 assert.equal(window.TayunetFreightStatus.isCurrent({health:{ok:true,available:true,checkedAt:new Date().toISOString()}}),true);
 assert.equal(window.TayunetFreightStatus.isCurrent({health:{ok:true,checkedAt:new Date(Date.now()-21*60000).toISOString()}}),false,'停止した収集を新しい情報として扱わない');
 console.log('Freight live transport and fallback: ok');
})().catch(e=>{console.error(e);process.exitCode=1;});
