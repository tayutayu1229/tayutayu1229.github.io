(function(global){
 'use strict';
 const client=global.TayunetManagedDb.client(global.supabase.createClient,'incidents');
 async function requireUser(options={}){
  try{
   const ready=await global.TayunetManagedDb.context();
   if(options.adminOnly&&ready.profile?.isAdmin!==true){
    alert('この操作には東京圏輸送情報システムの管理者権限が必要です。');
    location.replace('JRchr.html');return null;
   }
   if(location.pathname.endsWith('JRcht-top.html'))global.TayunetLoading?.done('ログインを確認しました。');
   return {user:{id:ready.user.uid,email:ready.user.email||''}};
  }catch(error){global.TayunetLoading?.error(error.message,()=>location.reload());return null;}
 }
 global.incidentAuth={client,requireUser};
})(window);
