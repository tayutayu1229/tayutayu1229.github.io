const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
function setup(ready){const calls=[];const window={TayunetAuthReady:Promise.resolve(ready)};const context={window,Headers,Request,AbortController,AbortSignal,setTimeout,clearTimeout,fetch:async(input,init)=>{calls.push({input,init});return new Response('{"ok":true}');}};vm.runInNewContext(fs.readFileSync('assets/js/managed-db-client.js','utf8'),context);return {api:window.TayunetManagedDb,calls};}
test('requests use Firebase ID token instead of client-supplied authorization',async()=>{
 const {api,calls}=setup({ok:true,user:{getIdToken:async()=> 'firebase-test-token'}});await api.request('/me',{headers:{Authorization:'Bearer forged'}});assert.equal(calls[0].init.headers.get('Authorization'),'Bearer firebase-test-token');
 assert.equal(calls[0].input,'https://incident-api.tayunet-traininfo.com/managed-db/me');
});
test('unapproved context cannot send a data request',async()=>{const {api,calls}=setup({ok:false});await assert.rejects(api.request('/me'));assert.equal(calls.length,0);});
test('query client points to Ubuntu and disables separate Supabase auth persistence',()=>{const {api}=setup({ok:true});let options;api.client((...args)=>{options=args;},'operations');assert.equal(options[0],'https://incident-api.tayunet-traininfo.com/managed-db/operations');assert.equal(options[2].auth.persistSession,false);assert.equal(options[2].auth.autoRefreshToken,false);});
test('unknown database is rejected',()=>{const {api}=setup({ok:true});assert.throws(()=>api.client(()=>{},'other'));});
