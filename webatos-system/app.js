(() => {
  "use strict";

  const NAV = [
    {id:"summary",label:"運行把握モニタ",menu:[["summary","現在状況"],["summary-history","過去検索"]]},
    {id:"station-delay",label:"駅遅延モニタ"},
    {id:"online",label:"駅列車在線モニタ",menu:[["online-single","単線区"],["online-multi","複数線区"],["online-platform","番線表示"],["online","ＵＴ・ＳＳ直通"],["online-keiyo","京葉武蔵野直通"],["online-chuo","中央・青梅直通"]]},
    {id:"search",label:"列車探索モニタ"},
    {id:"plan",label:"運転計画モニタ",menu:[["plan","運転計画書参照"],["plan-calendar","施行日別表示"]]},
    {id:"train-diagram",label:"列車別ダイヤモニタ"},
    {id:"station-diagram",label:"駅別ダイヤモニタ"},
    {id:"depot",label:"入出区ダイヤモニタ"},
    {id:"information",label:"運転情報モニタ"},
    {id:"certificate",label:"遅延証明モニタ"}
  ];
  const SCREEN_CODES = {top:"SPANSTOP01",summary:"SPAAJUHM01","summary-history":"SPAAJUHK01","station-delay":"SPAAJECM01",online:"SPAAJZMU01","online-single":"SPAAJZMS01","online-multi":"SPAAJZMF01","online-platform":"SPAAJZBS01","online-keiyo":"SPAAJZMK01","online-chuo":"SPAAJZMC01",search:"SPAAJRTM01",plan:"SPAAJUPM01","plan-calendar":"SPAAJUPM01","train-diagram":"SPAAJRDM01","station-diagram":"SPAAJEDM01",depot:"SPAAJNDM01",information:"SPAAJUJM01",certificate:"SPAAJCSM01"};

  const fallbackTrains = [
    {"odpt:trainNumber":"1896E","odpt:railway":"odpt.Railway:JR-East.Takasaki","odpt:fromStation":"odpt.Station:JR-East.Takasaki.Omiya","odpt:toStation":"odpt.Station:JR-East.Takasaki.Miyahara","odpt:destinationStation":["odpt.Station:JR-East.Takasaki.Takasaki"],"odpt:railDirection":"odpt.RailDirection:Outbound","odpt:delay":180},
    {"odpt:trainNumber":"2848Y","odpt:railway":"odpt.Railway:JR-East.Takasaki","odpt:fromStation":"odpt.Station:JR-East.Takasaki.Omiya","odpt:toStation":"odpt.Station:JR-East.Takasaki.Miyahara","odpt:destinationStation":["odpt.Station:JR-East.Takasaki.Kagohara"],"odpt:railDirection":"odpt.RailDirection:Outbound","odpt:delay":420},
    {"odpt:trainNumber":"2850Y","odpt:railway":"odpt.Railway:JR-East.Takasaki","odpt:fromStation":"odpt.Station:JR-East.Takasaki.Urawa","odpt:toStation":"odpt.Station:JR-East.Takasaki.Omiya","odpt:destinationStation":["odpt.Station:JR-East.Takasaki.Kagohara"],"odpt:railDirection":"odpt.RailDirection:Outbound","odpt:delay":0},
    {"odpt:trainNumber":"1928E","odpt:railway":"odpt.Railway:JR-East.Takasaki","odpt:fromStation":"odpt.Station:JR-East.Takasaki.Kawaguchi","odpt:toStation":"odpt.Station:JR-East.Takasaki.Urawa","odpt:destinationStation":["odpt.Station:JR-East.Takasaki.Takasaki"],"odpt:railDirection":"odpt.RailDirection:Inbound","odpt:delay":0},
    {"odpt:trainNumber":"543M","odpt:railway":"odpt.Railway:JR-East.Utsunomiya","odpt:fromStation":"odpt.Station:JR-East.Utsunomiya.Urawa","odpt:toStation":"odpt.Station:JR-East.Utsunomiya.Omiya","odpt:destinationStation":["odpt.Station:JR-East.Utsunomiya.Koganei"],"odpt:railDirection":"odpt.RailDirection:Outbound","odpt:delay":0},
    {"odpt:trainNumber":"4005M","odpt:railway":"odpt.Railway:JR-East.Takasaki","odpt:fromStation":"odpt.Station:JR-East.Takasaki.Omiya","odpt:toStation":"odpt.Station:JR-East.Takasaki.Miyahara","odpt:destinationStation":["odpt.Station:JR-East.Takasaki.Honjo"],"odpt:railDirection":"odpt.RailDirection:Outbound","odpt:delay":0}
  ];
  const fallbackInfo = [
    ["高崎線","遅延","高崎線は、線路内安全確認の影響で、上下線の一部列車に遅れがでています。"],
    ["中央線快速","遅延","中央線快速電車は、お客さま対応の影響で、一部列車に遅れがでています。"],
    ["山手線","平常","山手線は平常通り運転しています。"],
    ["常磐線","遅延","常磐線は、混雑の影響で上り線の一部列車に遅れがでています。"]
  ];
  const sampleTimetables = [
    {trainNumber:"9623M",type:"普通",line:"東海道客線",origin:"平　塚",destination:"熱　海",power:"EC",stops:[
      {station:"平　塚",arrival:"",departure:"14:15:00",trackN:"中１"},{station:"大　磯",arrival:"14:18:00",departure:"14:18:30",trackN:""},{station:"二　宮",arrival:"14:22:30",departure:"14:23:00",trackN:""},{station:"国府津",arrival:"14:26:30",departure:"14:27:00",trackN:"１"},{station:"小田原",arrival:"14:33:00",departure:"14:33:30",trackN:"客下"},{station:"熱　海",arrival:"14:55:00",departure:"＝",trackN:"下本"}
    ]},
    {trainNumber:"4005M",type:"特急電",line:"高崎",origin:"上　野",destination:"本　庄",power:"EC",stops:[{station:"大　宮",arrival:"19:24:00",departure:"19:25:00",trackN:"７番"}]}
  ];

  const state = {screen:"top", live:fallbackTrains, info:fallbackInfo, timetables:sampleTimetables, liveLoaded:false, timetableLoaded:false, selectedLine:"高崎", selectedStation:"大　宮", enlarged:false};
  const $ = (s,root=document) => root.querySelector(s);
  const $$ = (s,root=document) => [...root.querySelectorAll(s)];
  const esc = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const now = () => new Intl.DateTimeFormat("ja-JP",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date()).replaceAll("/","/");
  const hhmm = (date=new Date()) => `${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}:${String(date.getSeconds()).padStart(2,"0")}`;
  const stationName = id => String(id||"").split(".").pop().replaceAll("Omiya","大　宮").replaceAll("Urawa","浦　和").replaceAll("Kawaguchi","川　口").replaceAll("Miyahara","宮　原").replaceAll("Kagohara","籠　原").replaceAll("Takasaki","高　崎").replaceAll("Koganei","小金井").replaceAll("Honjo","本　庄");
  const lineName = id => ({"Takasaki":"高崎","Utsunomiya":"東北","Yamanote":"山手","ChuoRapid":"中央","KeihinTohokuNegishi":"京浜東北・根岸","Joban":"常磐","Yokosuka":"横須賀・総武快速"})[String(id||"").split(".").pop()] || String(id||"").split(".").pop();
  const delayMin = t => Math.max(0,Math.round(Number(t?.["odpt:delay"]||0)/60));
  const destination = t => stationName((t?.["odpt:destinationStation"]||[])[0]) || "　　　";

  function renderNav(){
    $("#main-nav").innerHTML = NAV.map(item=>`<div class="nav-wrap" data-wrap="${item.id}"><button class="nav-btn ${state.screen.startsWith(item.id)?"active":""} ${item.menu?"has-menu":""}" data-screen="${item.id}">${item.label}</button>${item.menu?`<div class="subnav">${item.menu.map(([id,label])=>`<button data-screen="${id}">${label}</button>`).join("")}</div>`:""}</div>`).join("");
  }

  async function fetchLive(){
    if(state.liveLoaded) return;
    try{
      const response=await fetch("/api/odpt/challenge/odpt:Train?odpt:operator=odpt.Operator:JR-East",{headers:{Accept:"application/json"}});
      if(!response.ok) throw new Error(String(response.status));
      const data=await response.json();
      if(Array.isArray(data)&&data.length){state.live=data;state.liveLoaded=true;}
    }catch(_){ showToast("ODPTに接続できないため、デモデータを表示しています。"); }
  }
  async function fetchInformation(){
    try{
      const response=await fetch("/api/odpt/challenge/odpt:TrainInformation?odpt:operator=odpt.Operator:jre-is",{headers:{Accept:"application/json"}});
      if(!response.ok) return;
      const data=await response.json();
      const mapped=data.map(x=>[lineName(x["odpt:railway"]),x["odpt:trainInformationStatus"]?.ja||"一般",x["odpt:trainInformationText"]?.ja||"平常通り運転しています。"]);
      if(mapped.length) state.info=mapped;
    }catch(_){/* fallback stays visible */}
  }
  async function fetchTimetables(){
    if(state.timetableLoaded) return;
    try{
      if(!window.TayunetPrivateData) return;
      const items=await window.TayunetPrivateData.fetchTimetables();
      if(Array.isArray(items)&&items.length){state.timetables=items;state.timetableLoaded=true;}
    }catch(_){/* authenticated data can be unavailable on public preview */}
  }

  function setScreen(id,{push=true}={}){
    $$(".nav-wrap").forEach(x=>x.classList.remove("open"));
    state.screen=id;
    renderNav();
    render();
    if(push) history.replaceState(null,"",`#${encodeURIComponent(id)}`);
    $("#workspace").focus({preventScroll:true});
  }

  function topMenu(){
    const primary=NAV.map(n=>`<button class="${n.menu?"has":""}" data-screen="${n.id}">${n.label}</button>`).join("");
    return `<div class="topmenu-title">　トップメニュー</div><div class="topmenu-grid"><section class="menu-panel"><h2>ATOS情報</h2><div class="menu-list">${primary}</div></section><section class="menu-panel"><h2>その他機能</h2><div class="menu-list"><button>ヘルプD/L</button><button>提供情報D/L</button></div></section></div>`;
  }
  function toolbar({search=false,date=false,station=true}={}){
    const dateValue=new Date().toISOString().slice(0,10).replaceAll("-","/");
    return `<div class="toolbar"><b class="toolbar-title">表示内容選択</b><label class="field-group">線区：<select data-field="line"><option>高崎</option><option>東北</option><option>山手</option><option>中央</option><option>常磐</option><option>東北貨物</option></select></label>${station?`<label class="field-group">駅：<select data-field="station"><option>大　宮</option><option>浦　和</option><option>池　袋</option><option>新　宿</option><option>東　京</option></select></label>`:""}${date?`<label class="field-group">施行日：<input class="highlight" value="${dateValue}"></label>`:""}<button class="action refresh" data-action="refresh">更　新</button>${search?`<b class="toolbar-title">検索条件</b><label class="field-group">列車番号：<select><option></option><option>回</option><option>単</option></select><input class="highlight" data-query="train"></label><button class="action" data-action="train-search">検　索</button>`:""}</div>`;
  }
  function table(headers,rows,cls=""){
    return `<table class="atos-table ${cls}"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  function summary(){
    const groups=new Map();
    state.live.forEach(t=>{const line=lineName(t["odpt:railway"]),d=delayMin(t),s=groups.get(line)||{max:0,train:"-",delayed:0,total:0,b:[0,0,0,0,0]};s.total++;if(d>0)s.delayed++;if(d>s.max){s.max=d;s.train=t["odpt:trainNumber"]||"-";}if(d>=20)s.b[4]++;else if(d>=15)s.b[3]++;else if(d>=10)s.b[2]++;else if(d>=5)s.b[1]++;else if(d>=3)s.b[0]++;groups.set(line,s);});
    const preferred=["山手","京浜東北・根岸","中央","常磐","横須賀・総武快速","東北","高崎","東海道","南武","埼京川越・山貨"];
    const rows=preferred.map((name,i)=>{const s=groups.get(name)||{max:[6,6,5,12,15,9,15,3,7,4][i],train:["1829G","1721B","1811H","1887H","回1806F","681M","1894E","1629E","1836F","1763K"][i],delayed:[8,4,4,6,5,3,9,1,2,2][i],total:[37,63,60,26,49,45,19,36,25,38][i],b:[2,2,1,0,0]};return [`<span class="yellow">${name}</span>`,`<span class="yellow">0:${String(s.max).padStart(2,"0")}</span>`,`<span class="yellow">${s.train}</span>`,`<span class="yellow">${s.delayed}</span>`,`<span class="yellow">${s.total}</span>`,...s.b.map(x=>`<span class="yellow">${x}</span>`)];});
    return `<div class="content-title"><span>遅延線区表示　<button class="action" style="height:48px;min-width:180px">全線区表示</button></span><span>${now()}　現在　<button class="action refresh" data-action="refresh">更　新</button></span></div><div class="delay-summary">${table(["線区","最大<br>遅延時分","最大<br>遅延列番","遅数","総本数","3分","5分","10分","15分","20分"],rows)}<div class="delay-note">注: <span>黄色文字</span> は、遅延線区です。</div></div>`;
  }
  function stationDelay(){
    const source=Array.from({length:12},(_,i)=>state.live[i%state.live.length]||fallbackTrains[i%fallbackTrains.length]);
    const rows=source.map((t,i)=>{const down=i<6,d=delayMin(t),from=stationName(t["odpt:fromStation"]),depart=hhmm(new Date(Date.now()+(i+1)*270000));return `<tr>${i===0?`<td class="line-cell" rowspan="12"><span>${esc(state.selectedLine==="高崎"?"東北貨物":state.selectedLine)}</span></td>`:""}${i===0?'<td class="direction-cell" rowspan="6">下り</td>':i===6?'<td class="direction-cell" rowspan="6">上り</td>':""}<td></td><td><a class="train-link" data-train="${esc(t["odpt:trainNumber"])}">${esc(t["odpt:trainNumber"]||"-")}</a></td><td class="delay-cell ${d?"yellow":""}">${String(d).padStart(3,"0")}</td><td>${esc(destination(t))}</td><td>${esc(from)}${i>1?" →":""}</td><td>…</td><td></td><td></td><td>${depart}</td><td></td><td></td><td>${down?"下本":"上本"}</td></tr>`;}).join("");
    return `<div class="station-delay-view"><div class="status-tabs"><button class="active">駅遅延モニタ</button><button>運転済列車情報</button><button>条件変更</button></div><div class="content-title"><b>駅名:【${state.selectedStation}】</b><span>${now()} 現在　<button class="action refresh" data-action="refresh">更　新</button></span></div><div class="monitor-box"><table class="atos-table station-delay-table"><thead><tr><th rowspan="2">線区</th><th rowspan="2">線別</th><th rowspan="2">抑止</th><th rowspan="2">列車番号</th><th rowspan="2">遅延<br>（分）</th><th rowspan="2">行先</th><th rowspan="2">在線位置<br>（→は発車済）</th><th colspan="3">着時間</th><th colspan="3">発時間</th><th rowspan="2">番線</th></tr><tr><th>計画</th><th>予測</th><th>到着</th><th>計画</th><th>予測</th><th>発車</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }
  function online(){
    const stations=["川　口","浦　和","大宮操","大　宮","宮　原","上　尾"];
    const trains=state.live.slice(0,10);
    return `${toolbar({search:true})}<div class="online-canvas"><div class="rail-line"></div>${stations.map((s,i)=>`<button class="station-node ${s.includes("大宮操")?"selected":""}" data-station="${s}" style="left:${130+i*360}px">${s}</button>`).join("")}<div class="platform"><h3>大　宮</h3>${[11,10,9,8,7,6].map(x=>`<div class="platform-row"><span>${x}<br>番</span><b></b></div>`).join("")}</div>${trains.map((t,i)=>`<button class="train-chip ${i%2?"up":"down"}" data-train="${esc(t["odpt:trainNumber"])}" style="left:${320+i*170}px;top:${i%2?650+(i%3)*65:390-(i%3)*65}px">${esc(t["odpt:trainNumber"])} ${String(delayMin(t)).padStart(3,"0")}<br>${esc(destination(t))}</button>`).join("")}</div>`;
  }
  function search(){
    return `<div class="search-card"><div class="search-row"><label>線区</label><div><select><option>東北貨物</option><option>高崎</option><option>東北</option></select></div></div><div class="search-row"><label>列車番号</label><div>冠記号 <select><option></option><option>回</option><option>単</option></select> 英数字(半角) <input class="highlight" data-query="train"></div></div></div><button class="action" data-action="train-search">検　索</button><div id="search-result"></div>`;
  }
  function plan(){
    const tt=state.timetables[0]||sampleTimetables[0];
    const stops=(tt.stops||[]).map(s=>`<tr><td>${esc(s.station)}</td><td>${esc(s.arrival||"")}</td><td>${esc(s.departure||"")}</td><td>${esc(s.trackN||"")}</td></tr>`).join("");
    return `<div class="plan-layout"><aside class="plan-filter"><h3>確定日</h3><div class="check-row"><input class="highlight" value="${new Date().toISOString().slice(0,10).replaceAll("-","/")}"> ☐ 前日分含む</div><h3>指令番号</h3><div class="check-row"><select><option></option></select> − <input style="width:120px"></div><h3>検索用文字列</h3><div class="check-row"><input value="臨時" style="width:90%"></div><h3>線区</h3>${["横須総武線","東海道客線","東海道貨線","横浜線","京葉線","南武線"].map(x=>`<div class="check-row"><input type="checkbox" checked> ${x}</div>`).join("")}<button class="action" style="margin:14px auto;display:block" data-action="plan-search">検　索</button></aside><section class="plan-sheet"><div class="plan-head">指令番号　YM−1020　　　伝達内容</div><table><tr><td>確定日</td><td colspan="3">◎臨時列車運転</td></tr><tr><td>${new Date().toLocaleDateString("ja-JP")}</td><td colspan="3">${esc(tt.trainNumber)}　${esc(tt.origin)} ～ ${esc(tt.destination)}</td></tr><tr><td>時刻</td><td colspan="3">${esc(tt.type||"電")}　　　普通</td></tr><tr><td>計画書線区</td><td colspan="3">${esc(tt.line||"東海道客線")}　　${esc(tt.power||"EC")}</td></tr><tr><td></td><td>着</td><td>発</td><td>番線</td></tr>${stops}</table></section></div>`;
  }
  function trainDiagram(){const dateValue=new Date().toISOString().slice(0,10).replaceAll("-","/");return `<div class="toolbar"><b class="toolbar-title">表示内容選択</b><label class="field-group">線区：<select data-field="line"><option>高崎</option><option>東北</option><option>東海道</option></select></label><label class="field-group">施行日：<input class="highlight" value="${dateValue}"></label><label class="field-group">列車番号：<select><option></option><option>回</option><option>単</option></select><input class="highlight" data-query="train"></label><button class="action refresh" data-action="train-diagram-search">更　新</button></div><div id="diagram-result"><div class="placeholder">施行日と列車番号を入力し「更新」を押すと列車別ダイヤを表示します。</div></div>`;}
  function stationDiagram(){
    const rows=state.live.slice(0,18).map((t,i)=>[i<9?"下り":"上り",`<a class="train-link" data-train="${esc(t["odpt:trainNumber"])}">${esc(t["odpt:trainNumber"]||"—")}</a>`,i%4===1?"特急電":"電","EC",hhmm(new Date(Date.now()+i*260000)),"",hhmm(new Date(Date.now()+i*260000+60000)),i%4===1?"７番":"８番","継送",`<a class="train-link" data-train="${esc(t["odpt:trainNumber"])}">${esc(t["odpt:trainNumber"]||"—")}</a>`,destination(t),delayMin(t)||"",""]);
    return `${toolbar({date:true})}<div class="content-title"><b>線区:【${state.selectedLine}】 駅名:【${state.selectedStation}】</b><span>${now()} 現在</span></div><div class="monitor-box">${table(["線別","列車番号","種別","動力","着時刻","予測","発時刻","番線","運用情報","運用列番","行先","遅延(分)","抑止"],rows)}</div>`;
  }
  function depot(){return `<div class="search-card"><div class="search-row"><label>線区</label><div>線区：<select><option>高崎</option><option>東北</option></select> 駅：<select><option>大　宮</option><option>小金井</option></select></div></div><div class="search-row"><label>列車番号</label><div>冠記号：<select><option></option><option>回</option></select> 英数字(半角)：<input class="highlight" data-query="train"></div></div><div class="search-row"><label>施行日</label><div>施行日：<input class="highlight" value="${new Date().toISOString().slice(0,10).replaceAll("-","/")}"></div></div></div><button class="action" data-action="depot-search">検　索</button><div id="search-result"></div>`;}
  function information(){
    const rows=state.info.slice(0,16).map((x,i)=>[new Date(Date.now()-i*900000).toLocaleString("ja-JP",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}),esc(x[0]),esc(x[1]),`<span class="yellow">【${esc(x[1])}】${esc(x[2])}</span>`,"−",String(i+1),"−"]);
    return `<div class="status-tabs"><button class="active">事故</button><button>一般</button></div><div style="text-align:right;margin:0 40px 15px"><button class="action refresh" data-action="refresh">更　新</button></div><div class="monitor-box">${table(["登録日時","タイトル","情報種別","内容","前","当","後"],rows,"information-table")}</div>`;
  }
  function certificate(){return `<div class="certificate-layout"><div class="certificate-search"><table><tbody><tr><th colspan="3">日時</th><td rowspan="2" colspan="3" class="certificate-submit"><button class="action" data-action="certificate-search">検　索</button></td></tr><tr><td colspan="3"><input class="highlight certificate-date" value="${new Date().toISOString().slice(0,10).replaceAll("-","/")}" aria-label="検索日"><button class="calendar-button" type="button" aria-label="カレンダー">▣</button></td></tr><tr><th colspan="2">開始</th><th colspan="2"></th><th colspan="2">終了</th></tr><tr><td><select aria-label="開始時刻"><option></option>${Array.from({length:24},(_,i)=>`<option>${i}</option>`).join("")}</select></td><td>時台</td><td colspan="2">～</td><td><select aria-label="終了時刻"><option></option>${Array.from({length:24},(_,i)=>`<option>${i}</option>`).join("")}</select></td><td>時台</td></tr></tbody></table></div><section class="certificate-result"><div id="search-result"></div></section></div>`;}

  function render(){
    const id=state.screen;
    const base=id.split("-").slice(0,2).join("-");
    const nav=NAV.find(n=>id===n.id||n.menu?.some(([sub])=>sub===id));
    $("#screen-name").textContent=nav?.label||"トップメニュー";
    $("#screen-id").textContent=SCREEN_CODES[id]||"SPANSTOP01";
    $("#head-line").textContent=state.selectedLine;$("#head-station").textContent=state.selectedStation;
    const views={top:topMenu,summary, "summary-history":summary,"station-delay":stationDelay,online,"online-single":online,"online-multi":online,"online-platform":online,"online-keiyo":online,"online-chuo":online,search,plan,"plan-calendar":plan,"train-diagram":trainDiagram,"station-diagram":stationDiagram,depot,information,certificate};
    $("#workspace").innerHTML=`${id!=="top"?'<button class="page-help" type="button" aria-label="画面ヘルプ" data-action="help">?</button>':""}${(views[id]||views[base]||topMenu)()}`;
    $$('[data-field="line"]').forEach(el=>el.value=state.selectedLine);
    $$('[data-field="station"]').forEach(el=>el.value=state.selectedStation);
  }

  function showToast(message){const old=$(".toast");if(old)old.remove();const node=document.createElement("div");node.className="toast";node.textContent=message;document.body.append(node);setTimeout(()=>node.remove(),3800);}
  function showTrain(number){const t=state.live.find(x=>String(x["odpt:trainNumber"])===String(number))||state.timetables.find(x=>String(x.trainNumber)===String(number));if(!t)return showToast("該当列車が見つかりません。");const modal=$("#modal"),content=$("#modal-content");content.innerHTML=`<h2>列車詳細　${esc(number)}</h2><dl><dt>線区</dt><dd>${esc(t.line||lineName(t["odpt:railway"]))}</dd><dt>行先</dt><dd>${esc(t.destination||destination(t))}</dd><dt>在線位置</dt><dd>${esc(t.origin||stationName(t["odpt:fromStation"]))} → ${esc(stationName(t["odpt:toStation"]))}</dd><dt>遅延</dt><dd>${delayMin(t)} 分</dd><dt>更新時刻</dt><dd>${hhmm()}</dd></dl>`;modal.showModal();}
  function runSearch(kind){const input=$('[data-query="train"]');const q=input?.value.trim();const container=$("#search-result");if(!q){if(container)container.innerHTML='<div class="placeholder">列車番号を入力してください。</div>';else showToast("列車番号を入力してください。");return;}const found=state.live.filter(t=>String(t["odpt:trainNumber"]||"").includes(q));if(!container){if(found[0])showTrain(found[0]["odpt:trainNumber"]);else showToast("該当列車はありません。");return;}container.innerHTML=found.length?`<div class="monitor-box">${table(["列車番号","線区","在線位置","行先","遅延"],found.map(t=>[`<a class="train-link" data-train="${esc(t["odpt:trainNumber"])}">${esc(t["odpt:trainNumber"])}</a>`,esc(lineName(t["odpt:railway"])),`${esc(stationName(t["odpt:fromStation"]))} → ${esc(stationName(t["odpt:toStation"]))}`,esc(destination(t)),`${delayMin(t)}分`]))}</div>`:'<div class="placeholder">該当列車はありません。</div>';}
  async function showTrainDiagram(){await fetchTimetables();const q=$('[data-query="train"]')?.value.trim();const tt=state.timetables.find(x=>!q||String(x.trainNumber||"").includes(q))||state.timetables[0];const target=$("#diagram-result");if(!tt||!target){showToast("該当する時刻表がありません。");return;}target.innerHTML=`<div class="content-title"><b>${esc(tt.trainNumber)}　${esc(tt.origin)} → ${esc(tt.destination)}</b><span>列車別ダイヤ</span></div><div class="monitor-box">${table(["駅名","着時刻","発時刻","番線","遅延","運用情報"],(tt.stops||[]).map((s,i)=>[esc(s.station),esc(s.arrival||"…"),esc(s.departure||"…"),esc(s.trackN||""),i===2?'<span class="yellow">002</span>':"000",i===0?"始発":"継送"]))}</div>`;}

  document.addEventListener("click",async event=>{
    const navButton=event.target.closest("[data-screen]");
    if(navButton){const wrap=navButton.closest(".nav-wrap");const item=NAV.find(n=>n.id===navButton.dataset.screen);if(item?.menu&&navButton.classList.contains("nav-btn")){const was=wrap.classList.contains("open");$$(".nav-wrap").forEach(x=>x.classList.remove("open"));if(!was)wrap.classList.add("open");return;}setScreen(navButton.dataset.screen);return;}
    const train=event.target.closest("[data-train]");if(train){showTrain(train.dataset.train);return;}
    const action=event.target.closest("[data-action]")?.dataset.action;
    if(action==="refresh"){event.target.disabled=true;await Promise.all([fetchLive(),fetchInformation()]);event.target.disabled=false;render();showToast(`更新しました　${hhmm()}`);}
    if(action==="train-search"||action==="depot-search")runSearch(action);
    if(action==="train-diagram-search")showTrainDiagram();
    if(action==="plan-search"){await fetchTimetables();render();showToast("運転計画を更新しました。");}
    if(action==="certificate-search"){$("#search-result").innerHTML=`<div class="monitor-box">${table(["線区","時間帯","最大遅延","証明状況"],[["高崎線","18時台","15分","発行可"],["常磐線","19時台","12分","発行可"]])}</div>`;}
    if(action==="help"){$("#modal-content").innerHTML='<h2>WebATOS ヘルプ</h2><p>上部のモニタボタンで画面を切り替えます。列車番号を押すと詳細を表示します。</p><p>ODPT接続時は最新情報、接続できない場合はデモデータを表示します。</p>';$("#modal").showModal();}
    if(action==="logout")showToast("公開版ではログアウト操作はありません。");
    if(action==="notices")showToast("お知らせは現在1件です。");
    if(action==="collapse"){$(".ticker").classList.toggle("hidden");}
  });
  document.addEventListener("change",event=>{if(event.target.matches('[data-field="line"]')){state.selectedLine=event.target.value;render();}if(event.target.matches('[data-field="station"]')){state.selectedStation=event.target.value;render();}});
  $$('[data-font]').forEach(btn=>btn.addEventListener("click",()=>{state.enlarged=btn.dataset.font==="large";document.documentElement.style.setProperty("--ui-scale",state.enlarged?"1.18":"1");}));
  window.addEventListener("keydown",e=>{if(e.key==="Escape")$$(".nav-wrap").forEach(x=>x.classList.remove("open"));});
  window.addEventListener("hashchange",()=>{const next=decodeURIComponent(location.hash.slice(1));if(next&&next!==state.screen&&NAV.some(n=>n.id===next||n.menu?.some(([id])=>id===next)))setScreen(next,{push:false});});

  const hash=decodeURIComponent(location.hash.slice(1));if(hash&&(NAV.some(n=>n.id===hash||n.menu?.some(([id])=>id===hash))))state.screen=hash;
  renderNav();render();
  Promise.all([fetchLive(),fetchInformation()]).then(()=>{if(["summary","station-delay","online","station-diagram","information"].some(x=>state.screen.startsWith(x))){render();}});
})();
