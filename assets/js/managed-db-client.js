(function(global){
 'use strict';
 const ORIGIN='https://incident-api.tayunet-traininfo.com/managed-db';
 async function context(){
  for(let attempt=0;!global.TayunetAuthReady&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,100));
  const ready=await global.TayunetAuthReady;
  if(!ready?.ok||!ready.user)throw new Error('ログインと利用承認が必要です。');
  return ready;
 }
 async function authenticatedFetch(input,init={}){
  const ready=await context();const headers=new Headers(input instanceof Request?input.headers:undefined);
  new Headers(init.headers).forEach((v,k)=>headers.set(k,v));
  headers.set('Authorization','Bearer '+await ready.user.getIdToken());
  return fetch(input,{...init,headers});
 }
 function client(createClient,project){
  if(!['incidents','accounting','operations'].includes(project))throw new Error('Unknown database');
  return createClient(`${ORIGIN}/${project}`,'tayunet-firebase-authenticated',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:authenticatedFetch}});
 }
 async function request(path,init={}){
  const response=await authenticatedFetch(ORIGIN+path,init);let data=null;
  if(response.status!==204)data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(response.status===403?'管理者権限または利用承認が必要です。':response.status===401?'ログインし直してください。':data?.message||data?.error||`取得に失敗しました（${response.status}）`);
  return data;
 }
 global.TayunetManagedDb={context,client,request,origin:ORIGIN};
})(window);
