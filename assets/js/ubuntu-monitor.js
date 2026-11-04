(() => {
  'use strict';
  const API = 'https://incident-api.tayunet-traininfo.com/server-monitor';
  const SHOOTING_API_HEALTH = 'https://photo-api.tayunet-traininfo.com/health';
  const ALLOWED = new Set(['admin@tayunet-traininfo.com','systemadmin@tayunet-traininfo.com','railwaymax185@gmail.com']);
  let context=null, status=null, pendingAction=null, refreshTimer=null;
  const $=id=>document.getElementById(id);
  const esc=value=>Ops.escapeHtml(value);
  const fmtBytes=value=>{const n=Number(value||0);if(n<1024)return `${n}B`;const units=['KB','MB','GB','TB'];let x=n/1024,i=0;while(x>=1024&&i<units.length-1){x/=1024;i++;}return `${x>=100?x.toFixed(0):x.toFixed(1)}${units[i]}`;};
  const fmtDuration=seconds=>{const s=Number(seconds||0),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return d?`${d}日 ${h}時間`:h?`${h}時間 ${m}分`:`${m}分`;};
  const level=(value,name)=>{const t=status?.thresholds?.[name];if(!t||value==null)return'unknown';return value>=t.critical?'critical':value>=t.warning?'warning':'ok';};
  const statusText=value=>({ok:'正常',warning:'警告',critical:'重大',error:'異常',running:'稼働',online:'稼働',exited:'停止',stopped:'停止',missing:'未検出'}[value]||value||'不明');
  const badge=value=>`<span class="ops-status ${['running','online'].includes(value)?'ok':['warning'].includes(value)?'warning':['critical','error','exited','stopped','missing'].includes(value)?'error':'unknown'}"><span class="ops-dot"></span>${esc(statusText(value))}</span>`;
  async function api(path,options={}){
    if(!context)throw new Error('管理者認証が完了していません');
    const token=await context.user.getIdToken(false);
    const response=await fetch(API+path,{cache:'no-store',...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(options.headers||{})}});
    let payload={};try{payload=await response.json();}catch(_){throw new Error(`監視API HTTP ${response.status}`);}
    if(!response.ok){
      const hints={firebase_token_required:'ログイン情報がありません。ログインし直してください。',firebase_token_invalid:'ログインの有効期限または認証情報を確認してください。',firebase_unavailable:'認証サービスに接続できません。時間を置いて再試行してください。',origin_not_allowed:'許可された管理ページからアクセスしてください。',confirmation_required:'対象名を確認してから操作してください。',action_in_progress:'別の操作を実行中です。完了後に再試行してください。'};
      const code=payload.error||'unknown_error',hint=payload.message||hints[code]||'処理に失敗しました。更新後も続く場合は管理ログを確認してください。';
      throw new Error(`${hint}（HTTP ${response.status} / ${code}${payload.requestId?` / 追跡ID ${payload.requestId}`:''}）`);
    }
    return payload;
  }
  function setKpi(id,value,sub,kind='ok'){const node=$(id);node.querySelector('.value').textContent=value;node.querySelector('.sub').textContent=sub;node.classList.toggle('red',kind==='critical');node.classList.toggle('amber',kind==='warning');}
  function renderAlerts(){const items=status.alerts||[];$('server-alerts').innerHTML=items.length?items.map(item=>`<div class="ops-alert ${item.severity}"><div><b>${esc(item.message)}</b><p>3回連続で検出した場合にDiscordへ通知します。</p></div></div>`).join(''):'<div class="ops-alert ok"><div><b>現在、重大な異常はありません</b><p>サーバー・サービス・外部APIは設定された基準内です。</p></div></div>';}
  function renderSummary(){
    const banner=$('health-banner'),state=status.status||'error';banner.className=`server-health-banner ${state}`;banner.querySelector('h2').textContent=state==='ok'?'Ubuntuサーバーは正常です':state==='warning'?'警告項目があります':'重大な異常を検出しました';banner.querySelector('p').textContent=`${status.hostname||'server'}／最終収集 ${new Date(status.collectedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}`;banner.querySelector('.server-health-state').textContent=statusText(state);
    const maxDisk=Math.max(0,...(status.disks||[]).map(x=>x.usedPercent||0));
    setKpi('kpi-cpu',`${status.cpu?.usedPercent??'-'}%`,`I/O待ち ${status.cpu?.iowaitPercent??'-'}%`,level(status.cpu?.usedPercent,'cpu'));
    setKpi('kpi-memory',`${status.memory?.usedPercent??'-'}%`,`${fmtBytes(status.memory?.usedBytes)} / ${fmtBytes(status.memory?.totalBytes)}`,level(status.memory?.usedPercent,'memory'));
    setKpi('kpi-disk',`${maxDisk}%`,(status.disks||[]).map(x=>`${x.mount} ${x.usedPercent}%`).join('／'),level(maxDisk,'disk'));
    setKpi('kpi-temp',status.temperature?.maxCelsius==null?'-':`${status.temperature.maxCelsius}℃`,'CPU・ストレージ温度',level(status.temperature?.maxCelsius,'temperature'));
    setKpi('kpi-network',`${fmtBytes(status.network?.rxBytesPerSec)}/s`, `送信 ${fmtBytes(status.network?.txBytesPerSec)}/s`);
    setKpi('kpi-uptime',fmtDuration(status.uptimeSeconds),'連続稼働時間');
    $('updated-at').textContent=`更新 ${new Date(status.collectedAt).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo'})}`;
  }
  function renderDetails(){
    const mem=status.memory||{},cpu=status.cpu||{},net=status.network||{};
    $('memory-detail').innerHTML=`<div class="metric-line ${level(mem.usedPercent,'memory')}"><span>メモリ</span><div class="ops-progress"><span style="width:${Math.min(100,mem.usedPercent||0)}%"></span></div><strong>${mem.usedPercent||0}%</strong></div><div class="metric-line ${level(mem.swapUsedPercent,'swap')}"><span>Swap</span><div class="ops-progress"><span style="width:${Math.min(100,mem.swapUsedPercent||0)}%"></span></div><strong>${mem.swapUsedPercent||0}%</strong></div><div class="detail-grid" style="margin-top:12px"><div class="detail-item"><small>I/O待ち</small><strong>${cpu.iowaitPercent||0}%</strong></div><div class="detail-item"><small>Load Average</small><strong>${(cpu.load||[]).join(' / ')}</strong></div><div class="detail-item"><small>Swap In</small><strong>${Number(status.vmstat?.pswpin||0).toLocaleString()}</strong></div><div class="detail-item"><small>Swap Out</small><strong>${Number(status.vmstat?.pswpout||0).toLocaleString()}</strong></div></div>`;
    const smart=(status.smart||[]).map(x=>`<li><div><b>${esc(x.device)}</b><small>${x.available?`温度 ${x.temperature??'-'}℃／代替済 ${x.reallocatedSectors||0}／保留 ${x.pendingSectors||0}`:'SMART取得準備中'}</small></div>${badge(x.available?(x.passed===false?'critical':'ok'):'unknown')}</li>`).join('');
    $('storage-detail').innerHTML=`<ul class="ops-list">${(status.disks||[]).map(x=>`<li><div><b>${esc(x.mount)}</b><small>${fmtBytes(x.usedBytes)} / ${fmtBytes(x.totalBytes)}　空き ${fmtBytes(x.freeBytes)}</small></div>${badge(level(x.usedPercent,'disk'))}</li>`).join('')}${smart}</ul>`;
    $('network-detail').innerHTML=`<div class="detail-grid"><div class="detail-item"><small>受信帯域</small><strong>${fmtBytes(net.rxBytesPerSec)}/秒</strong></div><div class="detail-item"><small>送信帯域</small><strong>${fmtBytes(net.txBytesPerSec)}/秒</strong></div><div class="detail-item"><small>パケットロス</small><strong>${net.packetLossPercent??'-'}%</strong></div><div class="detail-item"><small>外向き遅延</small><strong>${net.latencyMs??'-'}ms</strong></div></div>`;
    const backup=status.backup||{};$('backup-detail').innerHTML=`<ul class="ops-list"><li><div><b>最終バックアップ</b><small>${backup.lastRun?new Date(backup.lastRun).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):'Google Drive認証待ち'}</small></div>${badge(backup.ok===true?'ok':backup.ok===false?'critical':'unknown')}</li><li><div><b>保存先</b><small>HDD 6時間ごと／Google Drive 毎日3時</small></div></li></ul><p class="monitor-note">${esc(backup.detail||'設定準備中')}</p>`;
    const system=status.system||{},f2b=system.fail2ban||{};$('security-detail').innerHTML=`<ul class="ops-list"><li><div><b>失敗したsystemdサービス</b><small>${(system.failedServices||[]).length?esc(system.failedServices.join('、')):'ありません'}</small></div>${badge((system.failedServices||[]).length?'critical':'ok')}</li><li><div><b>OOM Killer</b><small>${(system.recentOom||[]).length?'直近10分に検出':'直近10分は検出なし'}</small></div>${badge((system.recentOom||[]).length?'critical':'ok')}</li><li><div><b>fail2ban</b><small>${f2b.available?'監視中':'導入準備中'}</small></div>${badge(f2b.available?(f2b.ok===false?'critical':'ok'):'unknown')}</li></ul>`;
  }
  function buttons(kind,name){return `<div class="service-actions"><button class="ops-btn" data-log-kind="${kind}" data-target="${esc(name)}">ログ</button><button class="ops-btn danger" data-restart-kind="${kind}" data-target="${esc(name)}">再起動</button></div>`;}
  function renderServices(){
    $('docker-body').innerHTML=(status.docker||[]).map(x=>x.error?`<tr><td colspan="7">${esc(x.error)}</td></tr>`:`<tr><td>${badge(x.state)}</td><td><b>${esc(x.name)}</b><br><span class="muted">${esc(x.status)}</span></td><td>${esc(x.cpuPercent)}</td><td class="resource-cell">${esc(x.memory)}<br><span class="muted">${esc(x.memoryPercent)}</span></td><td>${esc(x.netIO)}</td><td>${esc(x.blockIO)}</td><td>${buttons('docker',x.name)}</td></tr>`).join('');
    $('pm2-body').innerHTML=(status.pm2||[]).map(x=>x.error?`<tr><td colspan="7">${esc(x.error)}</td></tr>`:`<tr><td>${badge(x.status)}</td><td><b>${esc(x.name)}</b></td><td>${x.cpuPercent||0}%</td><td>${fmtBytes(x.memoryBytes)}</td><td>${x.restarts||0}回</td><td>${x.uptime?new Date(x.uptime).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):'-'}</td><td>${buttons('pm2',x.name)}</td></tr>`).join('');
    document.querySelectorAll('[data-log-kind]').forEach(button=>button.addEventListener('click',()=>showLogs(button.dataset.logKind,button.dataset.target)));
    document.querySelectorAll('[data-restart-kind]').forEach(button=>button.addEventListener('click',()=>confirmRestart(button.dataset.restartKind,button.dataset.target)));
  }
  function renderExternal(){
    $('endpoint-body').innerHTML=(status.endpoints||[]).map(x=>`<tr><td>${badge(x.ok?'ok':'critical')}</td><td><b>${esc(x.name)}</b><br><span class="muted mono">${esc(x.url)}</span></td><td>${x.status||'-'}</td><td>${x.responseMs}ms</td><td>${x.jsonValid==null?'-':x.jsonValid?'正常':'不正'}</td></tr>`).join('');
    $('tls-list').innerHTML=(status.tls||[]).map(x=>`<li><div><b>${esc(x.host)}</b><small>${x.expiresAt?new Date(x.expiresAt).toLocaleDateString('ja-JP'):'取得失敗'}／${esc(x.issuer||x.error||'')}</small></div>${badge(!x.ok?'critical':x.daysRemaining<=7?'critical':x.daysRemaining<=30?'warning':'ok')}<small>${x.daysRemaining??'-'}日</small></li>`).join('');
  }
  function setShootingApiStatus(kind,label){
    const node=$('shooting-api-status');
    node.className=`ops-status ${kind}`;
    $('shooting-api-status-text').textContent=label;
    $('shooting-spot-api-card').classList.toggle('api-error',kind==='error');
  }
  async function refreshShootingApi(){
    const started=performance.now(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
    setShootingApiStatus('unknown','確認中');
    try{
      const response=await fetch(`${SHOOTING_API_HEALTH}?monitor=${Date.now()}`,{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const health=await response.json();
      if(!health||health.ok!==true||typeof health.version!=='string'||!health.storage)throw new Error('応答形式が不正です');
      const storage=health.storage,total=Number(storage.totalBytes||0),used=Number(storage.usedBytes||0),free=Number(storage.freeBytes||0);
      setShootingApiStatus('ok','正常');
      $('shooting-api-response').textContent=`${Math.round(performance.now()-started)}ms`;
      $('shooting-api-version').textContent=health.version;
      $('shooting-api-spots').textContent=`${Number(health.shootingSpots||0).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}件`;
      $('shooting-api-photos').textContent=`${Number(health.photos||0).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}件`;
      $('shooting-api-storage').textContent=total?`${fmtBytes(used)} / ${fmtBytes(total)}（空き ${fmtBytes(free)}）`:'取得不可';
      $('shooting-api-checked').textContent=`確認 ${new Date().toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo'})}`;
    }catch(error){
      setShootingApiStatus('error','異常');
      $('shooting-api-response').textContent=error.name==='AbortError'?'12秒でタイムアウト':error.message;
      $('shooting-api-version').textContent='取得不可';
      $('shooting-api-spots').textContent='取得不可';
      $('shooting-api-photos').textContent='取得不可';
      $('shooting-api-storage').textContent='取得不可';
      $('shooting-api-checked').textContent=`失敗 ${new Date().toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo'})}`;
    }finally{clearTimeout(timeout);}
  }
  function renderChart(history){
    const svg=$('resource-chart'),rows=history.map(x=>({at:Date.parse(x.metrics?.collectedAt||x.at),m:x.metrics})).filter(x=>Number.isFinite(x.at)&&x.m?.cpu&&x.m?.memory);
    if(rows.length<2){svg.innerHTML='<text x="450" y="100" text-anchor="middle" fill="#65736b">履歴を収集中です</text>';return;}
    const left=40,right=880,top=12,bottom=150,start=rows[0].at,end=rows.at(-1).at,span=Math.max(1,end-start);
    const x=t=>left+(t-start)/span*(right-left),y=v=>bottom-Math.min(100,Math.max(0,v||0))*(bottom-top)/100;
    const stamp=t=>new Date(t).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
    const intervals=rows.slice(1).map((r,i)=>r.at-rows[i].at).filter(v=>v>0).sort((a,b)=>a-b),cadence=intervals[Math.floor((intervals.length-1)/2)]||300000;
    const lines=[['cpu',m=>m.cpu.usedPercent],['memory',m=>m.memory.usedPercent],['iowait',m=>m.cpu.iowaitPercent]];
    let markup=[0,50,100].map(v=>`<line class="grid" x1="${left}" y1="${y(v)}" x2="${right}" y2="${y(v)}"/><text x="4" y="${y(v)+4}" font-size="11" fill="#65736b">${v}%</text>`).join('');
    for(const [name,get] of lines){let segments=[],part=[];rows.forEach((r,i)=>{if(i&&r.at-rows[i-1].at>Math.max(180000,cadence*3)){if(part.length)segments.push(part);part=[];}part.push(`${x(r.at)},${y(get(r.m))}`);});if(part.length)segments.push(part);markup+=segments.map(points=>`<polyline class="${name}" points="${points.join(' ')}"/>`).join('');}
    markup+=rows.map(r=>`<circle cx="${x(r.at)}" cy="${y(r.m.cpu.usedPercent)}" r="5" fill="transparent"><title>${esc(stamp(r.at))} JST CPU ${r.m.cpu.usedPercent}% / メモリ ${r.m.memory.usedPercent}% / I/O ${r.m.cpu.iowaitPercent}%</title></circle>`).join('');
    markup+=[0,.25,.5,.75,1].map(f=>`<text x="${left+f*(right-left)}" y="175" text-anchor="${f===0?'start':f===1?'end':'middle'}" font-size="11" fill="#65736b">${esc(stamp(start+f*span))}</text>`).join('');
    svg.innerHTML=markup+'<text x="880" y="188" text-anchor="end" font-size="10" fill="#65736b">日本時間 JST</text>';
  }

  function renderEvents(events,actions){$('event-body').innerHTML=events.map(x=>`<tr><td>${new Date(x.created_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}</td><td>${badge(x.severity)}</td><td><b>${esc(x.message)}</b><br><span class="muted">${esc(x.code)}</span></td></tr>`).join('')||'<tr><td colspan="3">イベントはありません。</td></tr>';$('action-body').innerHTML=actions.map(x=>`<tr><td>${new Date(x.created_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}</td><td>${esc(x.actor)}</td><td>${esc(x.kind)}/${esc(x.target)}</td><td>${esc(x.action)}</td><td>${badge(x.success?'ok':'critical')}</td></tr>`).join('')||'<tr><td colspan="5">操作履歴はありません。</td></tr>';}
  async function refresh(){const shootingApiPromise=refreshShootingApi();try{$('refresh-monitor').disabled=true;const [newStatus,history,events,actions]=await Promise.all([api('/api/status'),api('/api/history?granularity=5m&limit=288'),api('/api/events'),api('/api/actions')]);status=newStatus;renderSummary();renderAlerts();renderDetails();renderServices();renderExternal();renderChart(history);renderEvents(events,actions);}catch(error){const banner=$('health-banner');banner.className='server-health-banner error';banner.querySelector('h2').textContent='監視情報を取得できません';banner.querySelector('p').textContent=error.message;banner.querySelector('.server-health-state').textContent='接続異常';$('server-alerts').innerHTML=`<div class="ops-alert critical"><div><b>Ubuntu監視APIへ接続できません</b><p>${esc(error.message)}。サーバー停止・Cloudflare Tunnel・認証状態を確認してください。</p></div></div>`;}finally{await shootingApiPromise;$('refresh-monitor').disabled=false;clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,60000);}}
  async function showLogs(kind,target){pendingAction=null;$('modal-title').textContent=`${target} ログ`;$('restart-confirm').hidden=true;$('modal-content').textContent='ログを取得しています…';$('service-modal').classList.add('open');try{const result=await api(`/api/logs?kind=${encodeURIComponent(kind)}&target=${encodeURIComponent(target)}&lines=100`);$('modal-content').textContent=result.logs||'ログはありません。';}catch(error){$('modal-content').textContent=error.message;}}
  function confirmRestart(kind,target){pendingAction={kind,target};$('modal-title').textContent=`${target} を再起動`;$('confirm-target').textContent=`${kind} / ${target}`;$('restart-confirm').hidden=false;$('modal-content').textContent='実行すると、再起動前後のログと実行者が記録され、Discordへ通知されます。';$('service-modal').classList.add('open');}
  async function executeRestart(){if(!pendingAction)return;const {kind,target}=pendingAction;if(!confirm(`${target} を再起動します。よろしいですか？`))return;$('execute-restart').disabled=true;$('modal-content').textContent='再起動しています…';try{const result=await api('/api/action',{method:'POST',body:JSON.stringify({kind,target,action:'restart',confirm:target})});$('modal-content').textContent=`再起動が完了しました。\n${result.detail||''}`;Ops.toast(`${target} を再起動しました。`);await Ops.audit('server_service_restart',{summary:`${kind}/${target} を再起動`});setTimeout(refresh,1000);}catch(error){$('modal-content').textContent=`再起動に失敗しました。\n${error.message}`;Ops.toast('再起動に失敗しました。','error');}finally{$('execute-restart').disabled=false;pendingAction=null;}}
  async function init(){context=await window.TayunetAuthReady;if(!context?.ok)return;const email=(context.user.email||'').toLowerCase();if(!ALLOWED.has(email)||context.profile?.isAdmin!==true){document.body.innerHTML='<main class="ops-main"><div class="ops-alert critical"><div><b>Ubuntu監視の権限がありません</b><p>この画面は指定されたシステム管理者3名だけが利用できます。</p></div></div><a class="ops-btn" href="/toppage.html">トップへ戻る</a></main>';return;}await refresh();}
  $('refresh-monitor').addEventListener('click',refresh);$('close-modal').addEventListener('click',()=>$('service-modal').classList.remove('open'));$('execute-restart').addEventListener('click',executeRestart);window.addEventListener('load',()=>setTimeout(init,300));
})();
