(function(global){
 'use strict';let retry=null;
 function show(message,busy=true){const el=document.getElementById('data-load-status');if(!el)return;el.hidden=false;el.classList.remove('is-error');el.setAttribute('aria-busy',String(busy));el.replaceChildren(document.createTextNode(message));}
 function error(message,action){show(message||'読み込みに失敗しました。通信状態を確認してください。',false);const el=document.getElementById('data-load-status');if(!el)return;el.classList.add('is-error');if(action){const button=document.createElement('button');button.type='button';button.textContent='再読み込み';button.onclick=action;el.append(button);}}
 global.TayunetLoading={show,error,done(message){show(message||'読み込みました。',false);}};
})(window);
