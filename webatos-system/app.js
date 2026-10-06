(() => {
  "use strict";

  const NAV = [
    {id:"summary",label:"運行把握モニタ",menu:[["summary","現在状況"],["summary-history","過去検索"]]},
    {id:"station-delay",label:"駅遅延モニタ"},
    {id:"online",label:"駅列車在線モニタ",menu:[["online-single","単線区"],["online-multi","複数線区"],["online-platform","番線表示"],["online","ＵＴ・ＳＳ直通"],["online-keiyo","京葉武蔵野直通"],["online-chuo","中央・青梅直通"],["online-netrains","千葉NETRAINS"]]},
    {id:"search",label:"列車探索モニタ"},
    {id:"plan",label:"運転計画モニタ",menu:[["plan","計画書参照"]]},
    {id:"train-diagram",label:"列車別ダイヤモニタ"},
    {id:"station-diagram",label:"駅別ダイヤモニタ"},
    {id:"depot",label:"入出区ダイヤモニタ"},
    {id:"information",label:"運転情報モニタ"},
    {id:"certificate",label:"遅延証明モニタ"},
    {id:"external",label:"他システムリンク",menu:[["external-broadcast","旅客一斉放送"]]}
  ];
  const SCREEN_CODES = {top:"SPANSTOP01",summary:"SPAAJUHM01","summary-history":"SPAAJUHK01","station-delay":"SPAAJECM01",online:"SPAAJZMU01","online-single":"SPAAJZMH01","online-multi":"SPAAJZMF01","online-platform":"SPAAJZBS01","online-keiyo":"SPAAJZMK01","online-chuo":"SPAAJZMC01","online-netrains":"SPAAJZMN01",search:"SPAAJRTM01",plan:"SPAAJUPM01","plan-calendar":"SPAAJUPM01","train-diagram":"SPAAJRDM01","station-diagram":"SPAAJEDM01",depot:"SPAAJNDM01",information:"SPAAJUJM01",certificate:"SPAAJCSM01"};
  const SCREEN_NAMES = {"online-single":"駅列車在線モニタ（単線区）","online-multi":"駅列車在線モニタ（複数線区）","online-platform":"駅列車在線モニタ（番線表示）",online:"駅列車在線モニタ（UT・SS）","online-keiyo":"駅列車在線モニタ（京葉武蔵）","online-chuo":"駅列車在線モニタ（中央青梅）","online-netrains":"駅列車在線モニタ（千葉NETRAINS）",plan:"運転計画書参照モニタ"};

  const LINE_CONFIG = {
    "山手":{railways:["Yamanote"],focus:"五反田",stations:["五反田","目黒","恵比寿","渋谷","原宿","代々木","新宿","新大久保","高田馬場","目白","池袋","大塚","巣鴨","駒込","田端","西日暮里","日暮里","鶯谷","上野","御徒町","秋葉原","神田","東京","有楽町","新橋","浜松町","田町","高輪ゲートウェイ","品川","大崎"]},
    "京浜東北・根岸":{railways:["KeihinTohokuNegishi"],focus:"大宮",stations:["大宮","さいたま新都心","与野","北浦和","浦和","南浦和","蕨","西川口","川口","赤羽","東十条","王子","上中里","田端","西日暮里","日暮里","鶯谷","上野","御徒町","秋葉原","神田","東京","有楽町","新橋","浜松町","田町","高輪ゲートウェイ","品川","大井町","大森","蒲田","川崎","鶴見","新子安","東神奈川","横浜","桜木町","関内","石川町","山手","根岸","磯子","新杉田","洋光台","港南台","本郷台","大船"]},
    "中央":{railways:["ChuoRapid"],focus:"新宿",stations:["東京","神田","御茶ノ水","四ツ谷","新宿","中野","高円寺","阿佐ケ谷","荻窪","西荻窪","吉祥寺","三鷹","武蔵境","東小金井","武蔵小金井","国分寺","西国分寺","国立","立川","日野","豊田","八王子","西八王子","高尾"]},
    "武蔵野":{railways:["Musashino"],focus:"新鶴見",stations:["新鶴見","梶ケ谷タ","府中本町","北府中","西国分寺","新小平","新秋津","東所沢","新座","北朝霞","西浦和","武蔵浦和","南浦和","東浦和","東川口","南越谷","越谷レイクタウン","吉川","吉川美南","新三郷","三郷","南流山","新松戸","新八柱","東松戸","市川大野","船橋法典","西船橋"]},
    "常磐":{railways:["Joban","JobanRapid"],focus:"松戸",stations:["上野","日暮里","三河島","南千住","北千住","松戸","柏","我孫子","天王台","取手","藤代","龍ケ崎市","牛久","ひたち野うしく","荒川沖","土浦","神立","高浜","石岡","羽鳥","岩間","友部","内原","赤塚","偕楽園","水戸","勝田"]},
    "常磐緩行":{railways:["JobanLocal"],focus:"松戸",stations:["綾瀬","亀有","金町","松戸","北松戸","馬橋","新松戸","北小金","南柏","柏","北柏","我孫子","天王台","取手"]},
    "横須賀・総武快速":{railways:["YokosukaSobuRapid","SobuRapid","Yokosuka"],focus:"東京",stations:["久里浜","衣笠","横須賀","田浦","東逗子","逗子","鎌倉","北鎌倉","大船","戸塚","東戸塚","保土ケ谷","横浜","新川崎","武蔵小杉","西大井","品川","新橋","東京","新日本橋","馬喰町","錦糸町","新小岩","市川","船橋","津田沼","稲毛","千葉"]},
    "東北":{railways:["Utsunomiya"],focus:"大宮",stations:["東京","上野","尾久","赤羽","浦和","さいたま新都心","大宮","土呂","東大宮","蓮田","白岡","新白岡","久喜","東鷲宮","栗橋","古河","野木","間々田","小山","小金井","自治医大","石橋","雀宮","宇都宮"]},
    "高崎":{railways:["Takasaki"],focus:"大宮",stations:["東京","上野","尾久","赤羽","浦和","さいたま新都心","大宮","宮原","上尾","北上尾","桶川","北本","鴻巣","北鴻巣","吹上","行田","熊谷","籠原","深谷","岡部","本庄","神保原","新町","倉賀野","高崎"]},
    "東海道":{railways:["Tokaido"],focus:"品川",stations:["東京","新橋","品川","川崎","横浜","戸塚","大船","藤沢","辻堂","茅ケ崎","平塚","大磯","二宮","国府津","鴨宮","小田原","早川","根府川","真鶴","湯河原","熱海"]},
    "東海道貨物":{railways:["TokaidoFreight"],focus:"横浜羽沢",stations:["東京貨物ターミナル","川崎貨物","浜川崎","鶴見","横浜羽沢","東戸塚","大船","茅ケ崎","相模貨物","国府津","西湘貨物","小田原"]},
    "南武":{railways:["Nambu"],focus:"武蔵小杉",stations:["川崎","尻手","矢向","鹿島田","平間","向河原","武蔵小杉","武蔵中原","武蔵新城","武蔵溝ノ口","津田山","久地","宿河原","登戸","中野島","稲田堤","矢野口","稲城長沼","南多摩","府中本町","分倍河原","西府","谷保","矢川","西国立","立川"]},
    "埼京川越・山貨":{railways:["SaikyoKawagoe","Saikyo"],focus:"池袋",stations:["大崎","恵比寿","渋谷","新宿","池袋","板橋","十条","赤羽","北赤羽","浮間舟渡","戸田公園","戸田","北戸田","武蔵浦和","中浦和","南与野","与野本町","北与野","大宮","日進","西大宮","指扇","南古谷","川越"]},
    "中央・総武緩行":{railways:["ChuoSobuLocal"],focus:"秋葉原",stations:["三鷹","吉祥寺","西荻窪","荻窪","阿佐ケ谷","高円寺","中野","東中野","大久保","新宿","代々木","千駄ケ谷","信濃町","四ツ谷","市ケ谷","飯田橋","水道橋","御茶ノ水","秋葉原","浅草橋","両国","錦糸町","亀戸","平井","新小岩","小岩","市川","本八幡","下総中山","西船橋","船橋","東船橋","津田沼","幕張本郷","幕張","新検見川","稲毛","西千葉","千葉"]},
    "東北貨物":{railways:["TohokuFreight","ShonanShinjuku"],focus:"大宮操",segments:[["池袋","田端操","赤羽","川口"],["浦和","大宮操","大宮"]],stations:["池袋","田端操","赤羽","川口","浦和","大宮操","大宮"]},
    "横浜":{railways:["Yokohama"],focus:"町田",stations:["東神奈川","大口","菊名","新横浜","小机","鴨居","中山","十日市場","長津田","成瀬","町田","古淵","淵野辺","矢部","相模原","橋本","相原","八王子みなみ野","片倉","八王子"]},
    "青梅":{railways:["Ome"],focus:"立川",stations:["立川","西立川","東中神","中神","昭島","拝島","牛浜","福生","羽村","小作","河辺","東青梅","青梅","宮ノ平","日向和田","石神前","二俣尾","軍畑","沢井","御嶽","川井","古里","鳩ノ巣","白丸","奥多摩"]},
    "京葉":{railways:["Keiyo"],focus:"東京",stations:["東京","八丁堀","越中島","潮見","新木場","葛西臨海公園","舞浜","新浦安","市川塩浜","二俣新町","南船橋","新習志野","幕張豊砂","海浜幕張","検見川浜","稲毛海岸","千葉みなと","蘇我"]},
    "五日市":{railways:["Itsukaichi"],focus:"拝島",stations:["拝島","熊川","東秋留","秋川","武蔵引田","武蔵増戸","武蔵五日市"]}
  };
  const LINE_NAMES = Object.keys(LINE_CONFIG);
  const LINE_VISUALS = {
    "山手":{color:"#00f000",down:"外回",up:"内回"},
    "京浜東北・根岸":{color:"#00a8f3",down:"南行",up:"北行"},
    "中央":{color:"#ff7f00",down:"下り",up:"上り"},
    "武蔵野":{color:"#ff6a00",down:"下り",up:"上り"},
    "常磐":{color:"#00a650",down:"下り",up:"上り"},
    "常磐緩行":{color:"#00b8a9",down:"下り",up:"上り"},
    "横須賀・総武快速":{color:"#0068c9",down:"下り",up:"上り"},
    "東北":{color:"#ff851b",down:"下り",up:"上り"},
    "高崎":{color:"#ff851b",down:"下り",up:"上り"},
    "東海道":{color:"#ff851b",down:"下り",up:"上り"},
    "東海道貨物":{color:"#ff851b",down:"下り",up:"上り"},
    "南武":{color:"#ffd400",down:"下り",up:"上り"},
    "埼京川越・山貨":{color:"#00a651",down:"下り",up:"上り"},
    "中央・総武緩行":{color:"#fff000",down:"東行",up:"西行"},
    "東北貨物":{color:"#ff851b",down:"下り",up:"上り"},
    "横浜":{color:"#7ac143",down:"下り",up:"上り"},
    "青梅":{color:"#ff7f00",down:"下り",up:"上り"},
    "京葉":{color:"#c90035",down:"下り",up:"上り"},
    "五日市":{color:"#ff7f00",down:"下り",up:"上り"}
  };
  const STATION_TRANSLATIONS = {
    Gotanda:"五反田",Meguro:"目黒",Ebisu:"恵比寿",Shibuya:"渋谷",Harajuku:"原宿",Yoyogi:"代々木",Shinjuku:"新宿",ShinOkubo:"新大久保",Takadanobaba:"高田馬場",Mejiro:"目白",Ikebukuro:"池袋",Otsuka:"大塚",Sugamo:"巣鴨",Komagome:"駒込",Tabata:"田端",NishiNippori:"西日暮里",Nippori:"日暮里",Uguisudani:"鶯谷",Ueno:"上野",Okachimachi:"御徒町",Akihabara:"秋葉原",Kanda:"神田",Tokyo:"東京",Yurakucho:"有楽町",Shimbashi:"新橋",Hamamatsucho:"浜松町",Tamachi:"田町",TakanawaGateway:"高輪ゲートウェイ",Shinagawa:"品川",Osaki:"大崎",
    Omiya:"大宮",SaitamaShintoshin:"さいたま新都心",Yono:"与野",KitaUrawa:"北浦和",Urawa:"浦和",MinamiUrawa:"南浦和",Warabi:"蕨",NishiKawaguchi:"西川口",Kawaguchi:"川口",Akabane:"赤羽",HigashiJujo:"東十条",Oji:"王子",KamiNakazato:"上中里",Kaminakazato:"上中里",Oku:"尾久",Miyahara:"宮原",Ageo:"上尾",KitaAgeo:"北上尾",Okegawa:"桶川",Kitamoto:"北本",Konosu:"鴻巣",KitaKonosu:"北鴻巣",Fukiage:"吹上",Gyoda:"行田",Kumagaya:"熊谷",Kagohara:"籠原",Fukaya:"深谷",Okabe:"岡部",Honjo:"本庄",Jimbohara:"神保原",Shimmachi:"新町",Kuragano:"倉賀野",Takasaki:"高崎",
    Ochanomizu:"御茶ノ水",Yotsuya:"四ツ谷",Nakano:"中野",Koenji:"高円寺",Asagaya:"阿佐ケ谷",Ogikubo:"荻窪",NishiOgikubo:"西荻窪",Kichijoji:"吉祥寺",Mitaka:"三鷹",MusashiSakai:"武蔵境",HigashiKoganei:"東小金井",MusashiKoganei:"武蔵小金井",Kokubunji:"国分寺",NishiKokubunji:"西国分寺",Kunitachi:"国立",Tachikawa:"立川",Hino:"日野",Toyoda:"豊田",Hachioji:"八王子",NishiHachioji:"西八王子",Takao:"高尾",
    Kawasaki:"川崎",Yokohama:"横浜",Totsuka:"戸塚",Ofuna:"大船",Oimachi:"大井町",Omori:"大森",Kamata:"蒲田",Tsurumi:"鶴見",ShinKoyasu:"新子安",HigashiKanagawa:"東神奈川",Sakuragicho:"桜木町",Kannai:"関内",Ishikawacho:"石川町",Yamate:"山手",Negishi:"根岸",Isogo:"磯子",ShinSugita:"新杉田",Yokodai:"洋光台",Konandai:"港南台",Hongodai:"本郷台",
    Matsudo:"松戸",Kashiwa:"柏",Abiko:"我孫子",Tennodai:"天王台",Toride:"取手",Fujishiro:"藤代",Ryugasakishi:"龍ケ崎市",Ushiku:"牛久",Hitachinoushiku:"ひたち野うしく",Arakawaoki:"荒川沖",Tsuchiura:"土浦",Ishioka:"石岡",Hatori:"羽鳥",Mito:"水戸",Katsuta:"勝田",KitaSenju:"北千住",MinamiSenju:"南千住",Mikawashima:"三河島",Ayase:"綾瀬",Kameari:"亀有",Kanamachi:"金町",Kinshicho:"錦糸町",Funabashi:"船橋",Tsudanuma:"津田沼",Chiba:"千葉",MusashiKosugi:"武蔵小杉",Machida:"町田",Hashimoto:"橋本",Soga:"蘇我"
  };
  const STATION_MONITOR_LABELS = {"さいたま新都心":"さ新都心","高輪ゲートウェイ":"高輪ゲト"};

  const state = {screen:"top", live:[], info:[], timetables:[], liveLoaded:false, timetableLoaded:false, liveError:false, infoError:false, timetableError:false, selectedLine:"東北貨物", selectedStation:"大宮操", modalStation:"", showDestination:false, enlarged:false};
  const $ = (s,root=document) => root.querySelector(s);
  const $$ = (s,root=document) => [...root.querySelectorAll(s)];
  const esc = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const setMarkup = (element,markup) => { element.innerHTML=markup; };
  const now = () => new Intl.DateTimeFormat("ja-JP",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date()).replaceAll("/","/");
  const hhmm = (date=new Date()) => `${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}:${String(date.getSeconds()).padStart(2,"0")}`;
  const stationName = id => {const key=String(id||"").split(".").pop();return STATION_TRANSLATIONS[key]||(/[^\x00-\x7f]/.test(key)?key:"");};
  const lineName = id => {const key=String(id||"").split(".").pop();return LINE_NAMES.find(name=>LINE_CONFIG[name].railways.includes(key))||(/[^\x00-\x7f]/.test(key)?key:"未対応線区");};
  const delayMin = t => Math.max(0,Math.round(Number(t?.["odpt:delay"]||0)/60));
  const destination = t => stationName((t?.["odpt:destinationStation"]||[])[0]) || "　　　";
  const noData = message => `<div class="data-empty">${esc(message)}</div>`;
  const infoTime = value => {const d=new Date(value);return value&&!Number.isNaN(d.getTime())?new Intl.DateTimeFormat("ja-JP",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(d):String(value||"");};

  function renderNav(){
    setMarkup($("#main-nav"),NAV.map(item=>`<div class="nav-wrap" data-wrap="${item.id}"><button class="nav-btn ${state.screen.startsWith(item.id)?"active":""} ${item.menu?"has-menu":""}" data-screen="${item.id}">${item.label}</button>${item.menu?`<div class="subnav">${item.menu.map(([id,label])=>`<button data-screen="${id}">${label}</button>`).join("")}</div>`:""}</div>`).join(""));
  }

  async function fetchLive(force=false){
    if(state.liveLoaded&&!force) return;
    try{
      const response=await fetch("/api/odpt/challenge/odpt:Train?odpt:operator=odpt.Operator:JR-East",{headers:{Accept:"application/json"}});
      if(!response.ok) throw new Error(String(response.status));
      const data=await response.json();
      state.live=Array.isArray(data)?data:[];state.liveLoaded=true;state.liveError=false;
    }catch(_){state.live=[];state.liveLoaded=true;state.liveError=true;}
  }
  async function fetchInformation(){
    try{
      const response=await fetch("/api/odpt/challenge/odpt:TrainInformation?odpt:operator=odpt.Operator:jre-is",{headers:{Accept:"application/json"}});
      if(!response.ok) throw new Error(String(response.status));
      const data=await response.json();
      const mapped=data.map(x=>[lineName(x["odpt:railway"]),x["odpt:trainInformationStatus"]?.ja||"",x["odpt:trainInformationText"]?.ja||"",x["dc:date"]||x["dct:valid"]||""]);
      state.info=mapped;state.infoError=false;
    }catch(_){state.info=[];state.infoError=true;}
  }
  async function fetchTimetables(){
    if(state.timetableLoaded) return;
    try{
      if(!window.TayunetPrivateData){state.timetableError=true;return;}
      const items=await window.TayunetPrivateData.fetchTimetables();
      state.timetables=Array.isArray(items)?items:[];state.timetableLoaded=true;state.timetableError=false;
    }catch(_){state.timetables=[];state.timetableLoaded=true;state.timetableError=true;}
  }

  function setScreen(id,{push=true}={}){
    $$(".nav-wrap").forEach(x=>x.classList.remove("open"));
    if(SPECIAL_DEFAULTS[id]&&state.screen!==id) [state.selectedLine,state.selectedStation]=SPECIAL_DEFAULTS[id];
    state.screen=id;
    renderNav();
    render();
    if(push) history.replaceState(null,"",`#${encodeURIComponent(id)}`);
    $("#workspace").focus({preventScroll:true});
  }

  function topMenu(){
    const primary=NAV.filter(n=>n.id!=="external").map(n=>`<button class="${n.menu?"has":""}" data-screen="${n.id}">${n.label}</button>`).join("");
    return `<div class="topmenu-title">　トップメニュー</div><div class="topmenu-grid"><section class="menu-panel"><h2>ATOS情報</h2><div class="menu-list">${primary}</div></section><section class="menu-panel"><h2>その他機能</h2><div class="menu-list"><button data-screen="external-broadcast">旅客一斉放送</button><button>ヘルプD/L</button><button>提供情報D/L</button></div></section></div>`;
  }
  function toolbar({search=false,date=false,station=true}={}){
    const dateValue=new Date().toISOString().slice(0,10).replaceAll("-","/");
    const lines=LINE_NAMES.map(line=>`<option${line===state.selectedLine?" selected":""}>${line}</option>`).join("");
    const stations=(LINE_CONFIG[state.selectedLine]?.stations||[]).map(name=>`<option${name===state.selectedStation?" selected":""}>${name}</option>`).join("");
    return `<div class="toolbar"><b class="toolbar-title">表示内容選択</b><label class="field-group">線区：<select data-field="line">${lines}</select></label>${station?`<label class="field-group">駅：<select data-field="station">${stations}</select></label>`:""}${date?`<label class="field-group">施行日：<input class="highlight" value="${dateValue}"></label>`:""}<button class="action refresh" data-action="refresh">更　新</button>${search?`<b class="toolbar-title">検索条件</b><label class="field-group">列車番号：<select><option></option><option>回</option><option>単</option></select><input class="highlight" data-query="train"></label><button class="action" data-action="train-search">検　索</button>`:""}</div>`;
  }
  function table(headers,rows,cls=""){
    return `<table class="atos-table ${cls}"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  function summary(){
    const groups=new Map();
    state.live.forEach(t=>{const line=lineName(t["odpt:railway"]),d=delayMin(t),s=groups.get(line)||{max:0,train:"-",delayed:0,total:0,b:[0,0,0,0,0]};s.total++;if(d>0)s.delayed++;if(d>s.max){s.max=d;s.train=t["odpt:trainNumber"]||"-";}if(d>=20)s.b[4]++;else if(d>=15)s.b[3]++;else if(d>=10)s.b[2]++;else if(d>=5)s.b[1]++;else if(d>=3)s.b[0]++;groups.set(line,s);});
    const preferred=["山手","京浜東北・根岸","中央","常磐","横須賀・総武快速","東北","高崎","東海道","南武","埼京川越・山貨"];
    const names=[...preferred.filter(name=>groups.has(name)),...[...groups.keys()].filter(name=>!preferred.includes(name))];
    const rows=names.map(name=>{const s=groups.get(name);return [`<span class="yellow">${esc(name)}</span>`,`<span class="yellow">0:${String(s.max).padStart(2,"0")}</span>`,`<span class="yellow">${esc(s.train)}</span>`,`<span class="yellow">${s.delayed}</span>`,`<span class="yellow">${s.total}</span>`,...s.b.map(x=>`<span class="yellow">${x}</span>`)];});
    return `<div class="content-title"><span>遅延線区表示　<button class="action">全線区表示</button></span><span>${now()}　現在　<button class="action refresh" data-action="refresh">更　新</button></span></div><div class="delay-summary">${rows.length?table(["線区","最大<br>遅延時分","最大<br>遅延列番","遅数","総本数","3分","5分","10分","15分","20分"],rows):noData(state.liveError?"ODPT列車データを取得できません。":"表示対象の列車データはありません。")}${rows.length?'<div class="delay-note">注: <span>黄色文字</span> は、遅延線区です。</div>':""}</div>`;
  }
  function stationDelay(){
    const config=LINE_CONFIG["東北貨物"];
    const trains=state.live.filter(t=>config.railways.includes(String(t["odpt:railway"]||"").split(".").pop()));
    const down=trains.filter(t=>!String(t["odpt:railDirection"]||"").includes("Inbound"));
    const up=trains.filter(t=>String(t["odpt:railDirection"]||"").includes("Inbound"));
    const source=[...down,...up].slice(0,14),downCount=Math.min(down.length,source.length),upCount=source.length-downCount;
    const rows=source.map((t,i)=>{const d=delayMin(t),from=stationName(t["odpt:fromStation"]),to=stationName(t["odpt:toStation"]);return `<tr>${i===0?`<td class="line-cell" rowspan="${source.length}"><span>東北貨物</span></td>`:""}${i===0&&downCount?`<td class="direction-cell" rowspan="${downCount}">下り</td>`:i===downCount&&upCount?`<td class="direction-cell" rowspan="${upCount}">上り</td>`:""}<td></td><td><a class="train-link" data-train="${esc(t["odpt:trainNumber"])}">${esc(t["odpt:trainNumber"]||"")}</a></td><td class="delay-cell ${d?"yellow":""}">${String(d).padStart(3,"0")}</td><td>${esc(destination(t))}</td><td>${esc(from)}${to?` →`:""}</td><td>…</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;}).join("");
    return `<div class="station-delay-view"><div class="status-tabs"><button class="active">駅遅延モニタ</button><button>運転済列車情報</button><button>条件変更</button></div><div class="content-title"><b>駅名:【${state.selectedStation}】</b><span>${now()} 現在　<button class="action refresh" data-action="refresh">更　新</button></span></div><div class="monitor-box"><table class="atos-table station-delay-table"><thead><tr><th rowspan="2">線区</th><th rowspan="2">線別</th><th rowspan="2">抑止</th><th rowspan="2">列車番号</th><th rowspan="2">遅延<br>（分）</th><th rowspan="2">行先</th><th rowspan="2">在線位置<br>（→は発車済）</th><th colspan="3">着時間</th><th colspan="3">発時間</th><th rowspan="2">番線</th></tr><tr><th>計画</th><th>予測</th><th>到着</th><th>計画</th><th>予測</th><th>発車</th></tr></thead><tbody>${rows||`<tr><td colspan="14">${state.liveError?"ODPT列車データを取得できません。":"表示対象の列車データはありません。"}</td></tr>`}</tbody></table></div></div>`;
  }
  const compact = value => String(value||"").replaceAll("　","").replaceAll(" ","");
  function routeSegments(){
    const config=LINE_CONFIG[state.selectedLine]||LINE_CONFIG["東北貨物"];
    if(config.segments)return config.segments;
    if(state.selectedLine==="山手")return [config.stations.slice(0,15),config.stations.slice(15).reverse()];
    return Array.from({length:Math.ceil(config.stations.length/4)},(_,i)=>config.stations.slice(i*4,i*4+4));
  }
  function onlineToolbar(){
    const lines=LINE_NAMES.map(line=>`<option${line===state.selectedLine?" selected":""}>${line}</option>`).join("");
    const stations=(LINE_CONFIG[state.selectedLine]?.stations||[]).map(name=>`<option${name===state.selectedStation?" selected":""}>${name}</option>`).join("");
    return `<div class="toolbar online-toolbar"><b class="toolbar-title">表示内容選択</b><label class="field-group">線区：<select data-field="line">${lines}</select></label><label class="field-group">駅：<select data-field="station">${stations}</select></label><label class="destination-toggle"><input type="checkbox" data-field="destination"${state.showDestination?" checked":""}>行先情報</label><button class="action refresh" data-action="refresh">更　新</button><b class="toolbar-title search-title">検索条件</b><label class="field-group train-query">列車番号：<select aria-label="冠記号"><option></option><option>回</option><option>単</option></select><input data-query="train" aria-label="列車番号"></label><button class="action" data-action="train-search">検　索</button></div>`;
  }
  const SPECIAL_LINES = {
    online:["東北貨物","高崎","東北","東海道","横須賀・総武快速"],
    "online-keiyo":["武蔵野","京葉"],
    "online-chuo":["中央","中央・総武緩行","南武","青梅","五日市"],
    "online-netrains":["横須賀・総武快速"]
  };
  const SPECIAL_DEFAULTS = {online:["東北貨物","大宮操"],"online-keiyo":["武蔵野","新鶴見"],"online-chuo":["中央","東京"],"online-netrains":["横須賀・総武快速","千葉"]};
  const SPECIAL_UPDATES = {
    online:[["東北・高崎","#ff851b"],["東海道","#ff851b"],["横須賀・総武快速","#0068c9"]],
    "online-keiyo":[["武蔵野","#ff6a00"],["京葉","#c90035"]],
    "online-chuo":[["中央","#ff7f00"],["中央・総武緩行","#fff000"],["南武","#ffd400"],["青梅","#ff7f00"],["五日市","#ff7f00"]],
    "online-netrains":[["武蔵野","#ff6a00"],["横須賀・総武快速","#0068c9"],["中央・総武緩行","#fff000"],["京葉","#c90035"],["成田線運行管理","#329a9d"],["総武本線運行管理","#f4bc00"],["外房線運行管理","#e44934"],["内房線ＴＩＤ装置","#00aada"]]
  };
  function specialToolbar(id){
    const names=SPECIAL_LINES[id]||SPECIAL_LINES.online;
    const lines=names.map(line=>`<option${line===state.selectedLine?" selected":""}>${line}</option>`).join("");
    const stations=(LINE_CONFIG[state.selectedLine]?.stations||[]).map(name=>`<option${name===state.selectedStation?" selected":""}>${name}</option>`).join("");
    return `<div class="toolbar online-toolbar special-toolbar"><b class="toolbar-title">表示内容選択</b><label class="field-group">線区：<select data-field="line">${lines}</select></label><label class="field-group">駅：<select data-field="station">${stations}</select></label><button class="action refresh" data-action="refresh">更　新</button><b class="toolbar-title search-title">検索条件</b><label class="field-group train-query">列車番号：<select aria-label="冠記号"><option></option><option>回</option><option>単</option></select><input data-query="train" aria-label="列車番号"></label><button class="action" data-action="train-search">検　索</button></div>`;
  }
  function updateStrip(id){
    const stamp=new Intl.DateTimeFormat("ja-JP",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date());
    return `<div class="special-updates"><b>更新日時</b>${(SPECIAL_UPDATES[id]||[]).map(([label,color])=>`<span style="--system-color:${color}"><strong>${label}</strong><small>${stamp}</small></span>`).join("")}</div>`;
  }
  function liveFor(lines){
    const keys=lines.flatMap(name=>LINE_CONFIG[name]?.railways||[]);
    return state.live.filter(t=>keys.includes(String(t["odpt:railway"]||"").split(".").pop()));
  }
  function specialChips(trains,placements,color){
    return trains.slice(0,placements.length).map((train,i)=>{const p=placements[i],delay=delayMin(train);return `<button class="special-train train-chip" data-train="${esc(train["odpt:trainNumber"])}" style="left:${p[0]}px;top:${p[1]}px;--route-color:${p[2]||color}"><span>${esc(train["odpt:trainNumber"]||"")}</span> <span class="${delay?"delay":""}">${String(delay).padStart(3,"0")}</span>${state.showDestination?`<small>${esc(destination(train))}</small>`:""}</button>`;}).join("");
  }
  function specialNode(name,x,y,{selected=false}={}){return `<button class="special-node${selected?" selected":""}" data-station="${esc(name)}" style="left:${x}px;top:${y}px">${esc(name)}</button>`;}
  function specialPlatform(name,x,y,tracks,{selected=false,wide=false}={}){
    return `<section class="special-platform${selected?" selected":""}${wide?" wide":""}" style="left:${x}px;top:${y}px"><button data-station="${esc(name)}">${esc(name)}</button>${tracks.map((track,i)=>`<div class="special-platform-row${i&&i%2===0?" divider":""}"><b>${track}</b><span></span></div>`).join("")}</section>`;
  }
  function onlineUtss(){
    const trains=liveFor(["東北貨物","高崎","東北","東海道","横須賀・総武快速"]);
    const chips=specialChips(trains,[[315,445],[900,445],[1545,445],[30,575],[1330,510],[1900,575]],"#ff851b");
    return `${specialToolbar("online")}${updateStrip("online")}<div class="special-canvas special-utss"><div class="special-line orange main"></div>${specialNode("川　口",130,510)}${specialNode("浦　和",498,510)}${specialNode("大宮操",866,510,{selected:true})}${specialPlatform("大　宮",1297,288,["11番","10番","9番","8番","7番","6番"],{wide:true})}${specialNode("宮　原",1728,510)}${chips}${state.liveError?'<div class="online-data-note">ODPT列車データを取得できません。在線図のみ表示しています。</div>':""}</div>`;
  }
  function onlineKeiyo(){
    const trains=liveFor(["武蔵野","京葉"]);
    const stations=["新鶴見","梶ケ谷タ","府中本町","北府中","西国分寺","新小平","新秋津","東所沢"];
    const nodes=stations.map((name,i)=>specialNode(name,108+i*368,430,{selected:compact(name)===compact(state.selectedStation)})).join("");
    const places=stations.flatMap((_,i)=>[[108+i*368,370],[108+i*368,495]]).slice(0,12);
    return `${specialToolbar("online-keiyo")}${updateStrip("online-keiyo")}<div class="special-canvas special-keiyo"><div class="special-line musashino main"></div>${nodes}${specialChips(trains,places,"#ff6a00")}${state.liveError?'<div class="online-data-note">ODPT列車データを取得できません。在線図のみ表示しています。</div>':""}</div>`;
  }
  function onlineChuo(){
    const trains=liveFor(["中央","中央・総武緩行","南武","青梅","五日市"]);
    const chips=specialChips(trains,[[545,455],[700,560],[1015,410,"#fff000"],[1160,565],[1600,350,"#fff000"],[1930,350,"#fff000"]],"#ff7f00");
    return `${specialToolbar("online-chuo")}${updateStrip("online-chuo")}<div class="special-canvas special-chuo"><div class="special-line chuo-main"></div><div class="special-line sobu-branch-v"></div><div class="special-line sobu-branch-h"></div>${specialPlatform("東　京",108,340,["1番","2番"],{selected:compact(state.selectedStation)===compact("東京")})}${specialNode("神　田",540,510)}${specialPlatform("御茶ノ水",908,238,["中下","総上","総下"],{wide:true})}${specialNode("水道橋",1525,315)}${specialNode("飯田橋",1900,315)}${chips}${state.liveError?'<div class="online-data-note">ODPT列車データを取得できません。在線図のみ表示しています。</div>':""}</div>`;
  }
  function onlineNetrains(){
    const trains=liveFor(["横須賀・総武快速"]);
    const chips=specialChips(trains,[[430,520,"#0068c9"],[930,372,"#0068c9"],[930,455,"#0068c9"],[1530,518,"#329a9d"],[1880,600,"#e44934"]],"#0068c9");
    return `${specialToolbar("online-netrains")}${updateStrip("online-netrains")}<div class="special-canvas special-netrains"><div class="special-line sobu-main"></div><div class="net-label">総武・成田線　下り次列車</div>${specialPlatform("稲　毛",66,470,["快速","緩行"],{wide:true})}${specialPlatform("千　葉",866,228,["10番","9番","8番","7番","6番"],{selected:true,wide:true})}${specialPlatform("東千葉",1245,280,["2番","1番"],{wide:true})}${specialPlatform("都　賀",1715,345,["2番","1番"],{wide:true})}${chips}${state.liveError?'<div class="online-data-note">ODPT列車データを取得できません。在線図のみ表示しています。</div>':""}</div>`;
  }
  function online(){
    const config=LINE_CONFIG[state.selectedLine]||LINE_CONFIG["東北貨物"];
    const visual=LINE_VISUALS[state.selectedLine]||LINE_VISUALS["東北貨物"];
    const lineTrains=state.live.filter(t=>config.railways.includes(String(t["odpt:railway"]||"").split(".").pop()));
    const segments=routeSegments();
    const segmentFor=name=>segments.findIndex(stations=>stations.some(station=>compact(station)===compact(name)));
    const assignedSegments=new Map(lineTrains.map(train=>{
      const fromSegment=segmentFor(stationName(train["odpt:fromStation"]));
      const toSegment=segmentFor(stationName(train["odpt:toStation"]));
      return [train,fromSegment>=0?fromSegment:toSegment];
    }));
    const boards=segments.map((stations,segmentIndex)=>{
      const segmentWidth=Math.max(980,stations.length*220);
      const stationButtons=stations.map((station,i)=>`<button class="station-node ${compact(station)===compact(state.selectedStation)?"selected":""}" data-station="${esc(station)}" style="left:${153+i*220}px">${esc(STATION_MONITOR_LABELS[station]||station)}</button>`).join("");
      const candidates=lineTrains.filter(train=>assignedSegments.get(train)===segmentIndex).slice(0,10);
      const chips=candidates.map((t,i)=>{
        const from=compact(stationName(t["odpt:fromStation"])),to=compact(stationName(t["odpt:toStation"]));
        const fromIndex=stations.findIndex(x=>compact(x)===from),toIndex=stations.findIndex(x=>compact(x)===to);
        const railDirection=String(t["odpt:railDirection"]||"");const up=railDirection.includes("Inbound")||railDirection.includes("InnerLoop")||railDirection.includes("Northbound");
        let left=153;
        if(fromIndex>=0&&toIndex>=0)left=153+(fromIndex+toIndex)*110;
        else if(fromIndex>=0)left=153+fromIndex*220;
        else if(toIndex>=0)left=153+toIndex*220;
        left=Math.min(segmentWidth-55,Math.max(55,left));
        const delay=delayMin(t);
        const destinationText=state.showDestination?`<small>${esc(destination(t))}</small>`:"";
        return `<button class="train-chip ${up?"up":"down"}" data-train="${esc(t["odpt:trainNumber"])}" style="left:${left}px"><span>${esc(t["odpt:trainNumber"]||"")}</span> <span class="${delay?"delay":""}">${String(delay).padStart(3,"0")}</span>${destinationText}</button>`;
      }).join("");
      return `<section class="route-segment" data-segment="${segmentIndex}" style="width:${segmentWidth}px"><div class="direction-ribbon down">${visual.down}</div><div class="route-rail"></div>${stationButtons}<div class="direction-ribbon up">${visual.up}</div>${chips}</section>`;
    }).join("");
    const empty=state.liveError?'<div class="online-data-note">ODPT列車データを取得できません。在線図のみ表示しています。</div>':(!lineTrains.length?'<div class="online-data-note">現在、この線区の在線列車データはありません。</div>':"");
    return `${onlineToolbar()}<div class="online-heading">■ ${esc(state.selectedLine)}　${now()} 現在</div><div class="online-canvas ${state.selectedLine==="山手"?"route-loop":""}" style="--route-color:${visual.color}">${boards}${empty}</div>`;
  }
  function onlinePlatform(){
    const config=LINE_CONFIG[state.selectedLine]||LINE_CONFIG["東北貨物"],visual=LINE_VISUALS[state.selectedLine]||LINE_VISUALS["東北貨物"];
    const live=state.live.filter(t=>config.railways.includes(String(t["odpt:railway"]||"").split(".").pop()));
    const tracks=Array.from({length:11},(_,i)=>11-i);
    const rows=tracks.map(track=>`<div class="platform-track ${track===10||track===7||track===4?"divider":""}"><b>${track}<br>番</b><span></span></div>`).join("");
    const chips=live.slice(0,5).map((train,i)=>{const delay=delayMin(train);return `<button class="platform-train train-chip" data-train="${esc(train["odpt:trainNumber"])}" style="top:${50+i*78}px;left:${i%2?760:145}px;border-color:${visual.color}"><span>${esc(train["odpt:trainNumber"]||"")}</span> <span class="${delay?"delay":""}">${String(delay).padStart(3,"0")}</span>${state.showDestination?`<small>${esc(destination(train))}</small>`:""}</button>`;}).join("");
    return `${onlineToolbar()}<div class="online-heading">■ ${esc(state.selectedLine)}　${now()} 現在</div><div class="platform-canvas" style="--route-color:${visual.color}"><div class="platform-rail"></div><button class="platform-focus" data-station="大宮操">大宮操</button><div class="platform-station"><h3>${esc(state.selectedStation)}</h3>${rows}</div>${chips}${state.liveError?'<div class="online-data-note">ODPT列車データを取得できません。番線図のみ表示しています。</div>':""}</div>`;
  }
  function search(){
    return `<div class="search-card"><div class="search-row"><label>線区</label><div><select><option>東北貨物</option><option>高崎</option><option>東北</option></select></div></div><div class="search-row"><label>列車番号</label><div>冠記号 <select><option></option><option>回</option><option>単</option></select> 英数字(半角) <input class="highlight" data-query="train"></div></div></div><button class="action" data-action="train-search">検　索</button><div id="search-result"></div>`;
  }
  function plan(){
    const day=new Date().toISOString().slice(0,10).replaceAll("-","/");
    const blankRows=Array.from({length:25},()=>"<tr><td></td><td></td></tr>").join("");
    return `<div class="plan-layout"><aside class="plan-filter"><h3>確定日</h3><div class="check-row plan-date"><input class="highlight" value="${day}"><button class="calendar-button" aria-label="カレンダー">▣</button><label><input type="checkbox"> 前日分含む</label></div><h3>指令番号</h3><div class="check-row plan-command"><select><option></option></select><b>−</b><input></div><h3>検索用文字列</h3><div class="check-row"><input class="plan-text"></div><h3>線区　<input type="checkbox" checked aria-label="線区一括選択"></h3>${["横須総武線","東海道客線","東海道貨線","横浜線","京葉線","南武線"].map(x=>`<label class="check-row plan-line"><input type="checkbox" checked> ${x}</label>`).join("")}<button class="action plan-search" data-action="plan-search">検　索</button></aside><section class="plan-results"><div class="plan-pages"><b>1</b> <u>2</u> <u>3</u> <u>4</u> <u>5</u> <u>…</u> <u>次へ</u></div><table class="plan-grid"><thead><tr><th>指令番号</th><th>伝達内容</th></tr></thead><tbody>${blankRows}</tbody></table></section></div>`;
  }
  function trainDiagram(){const dateValue=new Date().toISOString().slice(0,10).replaceAll("-","/");return `<div class="toolbar"><b class="toolbar-title">表示内容選択</b><label class="field-group">線区：<select data-field="line"><option>高崎</option><option>東北</option><option>東海道</option></select></label><label class="field-group">施行日：<input class="highlight" value="${dateValue}"></label><label class="field-group">列車番号：<select><option></option><option>回</option><option>単</option></select><input class="highlight" data-query="train"></label><button class="action refresh" data-action="train-diagram-search">更　新</button></div><div id="diagram-result"><div class="placeholder">施行日と列車番号を入力し「更新」を押すと列車別ダイヤを表示します。</div></div>`;}
  function stationDiagram(){
    const rows=state.live.slice(0,18).map(t=>[String(t["odpt:railDirection"]||"").includes("Outbound")?"下り":"上り",`<a class="train-link" data-train="${esc(t["odpt:trainNumber"])}">${esc(t["odpt:trainNumber"]||"")}</a>`,esc(t["odpt:trainType"]?.ja||""),"","","","","","",esc(t["odpt:trainNumber"]||""),destination(t),delayMin(t)||"",""]);
    return `${toolbar({date:true})}<div class="content-title"><b>線区:【${state.selectedLine}】 駅名:【${state.selectedStation}】</b><span>${now()} 現在</span></div><div class="monitor-box">${table(["線別","列車番号","種別","動力","着時刻","予測","発時刻","番線","運用情報","運用列番","行先","遅延(分)","抑止"],rows)}</div>`;
  }
  function depot(){return `<div class="search-card"><div class="search-row"><label>線区</label><div>線区：<select><option>高崎</option><option>東北</option></select> 駅：<select><option>大　宮</option><option>小金井</option></select></div></div><div class="search-row"><label>列車番号</label><div>冠記号：<select><option></option><option>回</option></select> 英数字(半角)：<input class="highlight" data-query="train"></div></div><div class="search-row"><label>施行日</label><div>施行日：<input class="highlight" value="${new Date().toISOString().slice(0,10).replaceAll("-","/")}"></div></div></div><button class="action" data-action="depot-search">検　索</button><div id="search-result"></div>`;}
  function information(){
    const rows=state.info.slice(0,16).map(x=>`<tr><td>${esc(infoTime(x[3]))}</td><td>${esc(x[0])}</td><td>${esc(x[1])}</td><td class="left yellow">【${esc(x[1])}】${esc(x[2])}</td><td></td><td></td><td></td></tr>`).join("");
    const grid=rows?`<table class="atos-table information-table"><thead><tr><th rowspan="2">登録日時</th><th rowspan="2">タイトル</th><th rowspan="2">情報<br>種別</th><th rowspan="2">内容</th><th colspan="3">関連文書番号</th></tr><tr><th>前</th><th>当</th><th>後</th></tr></thead><tbody>${rows}</tbody></table><div class="information-note">注: <span>黄色文字</span> は、現在表示中の内容です。</div>`:noData(state.infoError?"ODPT運行情報を取得できません。":"運行情報はありません。");
    return `<div class="information-view"><div class="status-tabs"><button class="active">事故</button><button>一般</button></div><div class="information-actions"><button class="action refresh" data-action="refresh">更　新</button></div>${state.info.length>12?'<div class="information-pages"><b>1</b> <button>2</button> <button>次へ</button></div>':""}<div class="monitor-box">${grid}</div></div>`;
  }
  function certificate(){return `<div class="certificate-layout"><div class="certificate-search"><table><tbody><tr><th colspan="3">日時</th><td rowspan="2" colspan="3" class="certificate-submit"><button class="action" data-action="certificate-search">検　索</button></td></tr><tr><td colspan="3"><input class="highlight certificate-date" value="${new Date().toISOString().slice(0,10).replaceAll("-","/")}" aria-label="検索日"><button class="calendar-button" type="button" aria-label="カレンダー">▣</button></td></tr><tr><th colspan="2">開始</th><th colspan="2"></th><th colspan="2">終了</th></tr><tr><td><select aria-label="開始時刻"><option></option>${Array.from({length:24},(_,i)=>`<option>${i}</option>`).join("")}</select></td><td>時台</td><td colspan="2">～</td><td><select aria-label="終了時刻"><option></option>${Array.from({length:24},(_,i)=>`<option>${i}</option>`).join("")}</select></td><td>時台</td></tr></tbody></table></div><section class="certificate-result"><div id="search-result"></div></section></div>`;}

  function render(){
    const id=state.screen;
    const base=id.split("-").slice(0,2).join("-");
    const nav=NAV.find(n=>id===n.id||n.menu?.some(([sub])=>sub===id));
    $("#screen-name").textContent=SCREEN_NAMES[id]||nav?.label||"トップメニュー";
    $("#screen-id").textContent=id==="online-single"&&state.selectedLine==="山手"?"SPAAJZMY01":SCREEN_CODES[id]||"SPANSTOP01";
    $("#head-line").textContent="東北貨物";$("#head-station").textContent="大宮操";
    const views={top:topMenu,summary, "summary-history":summary,"station-delay":stationDelay,online:onlineUtss,"online-single":online,"online-multi":online,"online-platform":onlinePlatform,"online-keiyo":onlineKeiyo,"online-chuo":onlineChuo,"online-netrains":onlineNetrains,search,plan,"train-diagram":trainDiagram,"station-diagram":stationDiagram,depot,information,certificate};
    setMarkup($("#workspace"),`${id!=="top"?'<button class="page-help" type="button" aria-label="画面ヘルプ" data-action="help">?</button>':""}${(views[id]||views[base]||topMenu)()}`);
    $$('[data-field="line"]').forEach(el=>el.value=state.selectedLine);
    $$('[data-field="station"]').forEach(el=>el.value=state.selectedStation);
  }

  function showToast(message){const old=$(".toast");if(old)old.remove();const node=document.createElement("div");node.className="toast";node.textContent=message;document.body.append(node);setTimeout(()=>node.remove(),3800);}
  function openMonitorModal(html){const modal=$("#modal");modal.className="monitor-modal";setMarkup($("#modal-content"),html);if(!modal.open)modal.showModal();}
  async function showTrain(number){await fetchTimetables();const live=state.live.find(x=>String(x["odpt:trainNumber"])===String(number));const tt=state.timetables.find(x=>String(x.trainNumber)===String(number));if(!live&&!tt)return showToast("該当列車が見つかりません。");const stops=(tt?.stops||[]).map((s,i)=>`<tr><td>${i===0?esc(tt.type||""):""}</td><td></td><td>${esc(s.station||"")}</td><td>${esc(s.arrival||"")}</td><td></td><td></td><td>${esc(s.departure||"")}</td><td></td><td></td><td>${esc(s.trackN||"")}</td><td>${esc(s.delay||"")}</td><td>${esc(s.operationInfo||"")}</td><td>${esc(s.operationTrainNumber||"")}</td></tr>`).join("");const from=tt?.origin||stationName(live?.["odpt:fromStation"]),to=tt?.destination||stationName(live?.["odpt:toStation"]);openMonitorModal(`<div class="monitor-modal-head"><div><b>■${esc(tt?.line||lineName(live?.["odpt:railway"]))} 施行日:${esc(tt?.date||"")}</b><br><b>運転区間:${esc(from)}～${esc(to)} 列車番号: ${esc(number)}</b></div><span>${now()} 現在</span><button class="close-action" data-action="close-modal">✖　閉じる</button></div><div class="monitor-modal-table">${stops?`<table class="atos-table train-detail-table"><thead><tr><th rowspan="2">列車種別</th><th rowspan="2">抑止</th><th rowspan="2">駅名</th><th colspan="3">着時刻</th><th colspan="3">発時刻</th><th rowspan="2">番線</th><th rowspan="2">遅延<br>（分）</th><th rowspan="2">運用<br>情報</th><th rowspan="2">運用列番</th></tr><tr><th>計画</th><th>予測</th><th>到着</th><th>計画</th><th>予測</th><th>発車</th></tr></thead><tbody>${stops}</tbody></table>`:noData(state.timetableError?"時刻表JSONを取得できません。":"この列車の時刻表データはありません。")}</div><div class="symbol-note">「$」…運休　「＊」…運済　「#」…変更　「¥」…運転禁止</div>`);}
  function showStationModal(station){state.modalStation=station;const config=LINE_CONFIG[state.selectedLine];const source=state.live.filter(t=>config?.railways.includes(String(t["odpt:railway"]||"").split(".").pop())).filter(t=>[stationName(t["odpt:fromStation"]),stationName(t["odpt:toStation"])].some(x=>compact(x)===compact(station))).slice(0,14);const rows=source.map((t,i)=>`<tr>${i===0?`<td class="line-cell" rowspan="${source.length}">${esc(state.selectedLine)}</td>`:""}<td>${String(t["odpt:railDirection"]||"").includes("Inbound")?"上り":"下り"}</td><td></td><td><a class="train-link" data-train="${esc(t["odpt:trainNumber"])}">${esc(t["odpt:trainNumber"]||"")}</a></td><td class="${delayMin(t)?"yellow":""}">${String(delayMin(t)).padStart(3,"0")}</td><td>${esc(destination(t))}</td><td>${esc(stationName(t["odpt:fromStation"]))}${t["odpt:toStation"]?" →":""}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join("");openMonitorModal(`<div class="monitor-modal-head station-modal-head"><b>駅名:【${esc(station)}】</b><span>${now()} 現在</span><button class="action refresh" data-action="modal-refresh">更　新</button><button class="close-action" data-action="close-modal">✖　閉じる</button></div><div class="monitor-modal-table"><table class="atos-table station-modal-table"><thead><tr><th rowspan="2">線区</th><th rowspan="2">線別</th><th rowspan="2">抑止</th><th rowspan="2">列車番号</th><th rowspan="2">遅延<br>（分）</th><th rowspan="2">行先</th><th rowspan="2">在線位置<br>（→は発車済）</th><th colspan="3">着時間</th><th colspan="3">発時間</th><th rowspan="2">番線</th></tr><tr><th>計画</th><th>予測</th><th>到着</th><th>計画</th><th>予測</th><th>発車</th></tr></thead><tbody>${rows||`<tr><td colspan="14">${state.liveError?"ODPT列車データを取得できません。":"この駅に在線する列車はありません。"}</td></tr>`}</tbody></table></div>`);}
  function runSearch(kind){const input=$('[data-query="train"]');const q=input?.value.trim();const container=$("#search-result");if(!q){if(container)setMarkup(container,'<div class="placeholder">列車番号を入力してください。</div>');else showToast("列車番号を入力してください。");return;}const found=state.live.filter(t=>String(t["odpt:trainNumber"]||"").includes(q));if(!container){if(found[0])showTrain(found[0]["odpt:trainNumber"]);else showToast("該当列車はありません。");return;}setMarkup(container,found.length?`<div class="monitor-box">${table(["列車番号","線区","在線位置","行先","遅延"],found.map(t=>[`<a class="train-link" data-train="${esc(t["odpt:trainNumber"])}">${esc(t["odpt:trainNumber"])}</a>`,esc(lineName(t["odpt:railway"])),`${esc(stationName(t["odpt:fromStation"]))} → ${esc(stationName(t["odpt:toStation"]))}`,esc(destination(t)),`${delayMin(t)}分`]))}</div>`:'<div class="placeholder">該当列車はありません。</div>');}
  async function showTrainDiagram(){await fetchTimetables();const q=$('[data-query="train"]')?.value.trim();const tt=state.timetables.find(x=>!q||String(x.trainNumber||"").includes(q))||state.timetables[0];const target=$("#diagram-result");if(!tt||!target){showToast("該当する時刻表がありません。");return;}setMarkup(target,`<div class="content-title"><b>${esc(tt.trainNumber)}　${esc(tt.origin)} → ${esc(tt.destination)}</b><span>列車別ダイヤ</span></div><div class="monitor-box">${table(["駅名","着時刻","発時刻","番線","遅延","運用情報"],(tt.stops||[]).map(s=>[esc(s.station),esc(s.arrival||""),esc(s.departure||""),esc(s.trackN||""),esc(s.delay||""),esc(s.operationInfo||"")]))}</div>`);}

  document.addEventListener("click",async event=>{
    const navButton=event.target.closest("[data-screen]");
    if(navButton){if(navButton.dataset.screen==="external-broadcast"){window.open("https://jreissei.tayunet-traininfo.com/","_blank","noopener");return;}const wrap=navButton.closest(".nav-wrap");const item=NAV.find(n=>n.id===navButton.dataset.screen);if(item?.menu&&navButton.classList.contains("nav-btn")){const was=wrap.classList.contains("open");$$(".nav-wrap").forEach(x=>x.classList.remove("open"));if(!was)wrap.classList.add("open");return;}setScreen(navButton.dataset.screen);return;}
    const train=event.target.closest("[data-train]");if(train){await showTrain(train.dataset.train);return;}
    const station=event.target.closest("[data-station]");if(station){showStationModal(station.dataset.station);return;}
    const action=event.target.closest("[data-action]")?.dataset.action;
    if(action==="refresh"){event.target.disabled=true;await Promise.all([fetchLive(true),fetchInformation()]);event.target.disabled=false;render();showToast(`更新しました　${hhmm()}`);}
    if(action==="train-search"||action==="depot-search")runSearch(action);
    if(action==="train-diagram-search")showTrainDiagram();
    if(action==="plan-search"){showToast("該当する運転計画データはありません。");}
    if(action==="certificate-search"){setMarkup($("#search-result"),noData("遅延証明データAPIは未接続です。"));}
    if(action==="modal-refresh"){await fetchLive(true);showStationModal(state.modalStation||state.selectedStation);}
    if(action==="close-modal"){$("#modal").close();}
    if(action==="help"){const modal=$("#modal");modal.className="";setMarkup($("#modal-content"),'<h2>WebATOS ヘルプ</h2><p>上部のモニタボタンで画面を切り替えます。列車番号を押すと詳細を表示します。</p><p>列車情報はODPT、ダイヤ情報は東京圏輸送情報システムの時刻表JSONを使用します。</p>');modal.showModal();}
    if(action==="logout")showToast("公開版ではログアウト操作はありません。");
    if(action==="notices")showToast("お知らせは現在1件です。");
    if(action==="collapse"){$(".ticker").classList.toggle("hidden");}
  });
  document.addEventListener("change",event=>{
    if(event.target.matches('[data-field="line"]')){state.selectedLine=event.target.value;state.selectedStation=LINE_CONFIG[state.selectedLine]?.focus||LINE_CONFIG[state.selectedLine]?.stations?.[0]||"";render();}
    if(event.target.matches('[data-field="station"]')){state.selectedStation=event.target.value;render();}
    if(event.target.matches('[data-field="destination"]')){state.showDestination=event.target.checked;render();}
  });
  $$('[data-font]').forEach(btn=>btn.addEventListener("click",()=>{state.enlarged=btn.dataset.font==="large";document.documentElement.style.setProperty("--ui-scale",state.enlarged?"1.18":"1");}));
  window.addEventListener("keydown",e=>{if(e.key==="Escape")$$(".nav-wrap").forEach(x=>x.classList.remove("open"));});
  window.addEventListener("hashchange",()=>{const next=decodeURIComponent(location.hash.slice(1));if(next&&next!==state.screen&&NAV.some(n=>n.id===next||n.menu?.some(([id])=>id===next)))setScreen(next,{push:false});});

  const hash=decodeURIComponent(location.hash.slice(1));if(hash&&(NAV.some(n=>n.id===hash||n.menu?.some(([id])=>id===hash))))state.screen=hash;
  if(SPECIAL_DEFAULTS[state.screen]) [state.selectedLine,state.selectedStation]=SPECIAL_DEFAULTS[state.screen];
  renderNav();render();
  Promise.all([fetchLive(),fetchInformation()]).then(()=>{if(["summary","station-delay","online","station-diagram","information"].some(x=>state.screen.startsWith(x))){render();}});
})();
