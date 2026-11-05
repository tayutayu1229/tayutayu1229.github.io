'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFile} = require('node:child_process');
const DATA = '/home/yoshi/.local/share/tayunet-server-monitor';
const HELPER = '/home/yoshi/services/tayunet-server-monitor/discord_command.py';
const GUILD = '1489628881106243664';
const names = {status:'Ubuntuの状態',services:'サービスの稼働状態',report:'現在のデータで定時報を表示',logs:'最近のサービスログ',github:'GitHubの状態',events:'障害・復旧履歴',help:'使い方'};
const targets = ['docker:incident-share','docker:atos-delay-history','docker:tayunet-photo-archive','docker:atos-history-tunnel','docker:jreast-press-bot-press-release-bot-1','docker:jre-aivis','docker:jre-voicevox','pm2:file-api','pm2:filet-main','pm2:flight-alert','pm2:timetable-app','pm2:tokyo-discord-bot','pm2:jre-issei','pm2:jre-discord-voice'];
const commands = [{name:'ubuntu',description:'東京圏輸送情報システムのUbuntu・GitHub確認',options:Object.entries(names).map(([name,description])=>({type:1,name,description,options:name==='logs'?[{type:3,name:'target',description:'ログ対象',required:true,choices:targets.map(value=>({name:value,value}))}]:name==='github'?[{type:3,name:'view',description:'確認する項目',choices:['summary','commits','actions','deploy','pulls','issues','connection'].map(value=>({name:({summary:'基本情報',commits:'最新5コミット',actions:'Actionsと失敗箇所',deploy:'公開状況と未公開の差',pulls:'オープンPR',issues:'オープンIssue',connection:'接続・認証・API残数'})[value],value}))},{type:3,name:'repository',description:'登録リポジトリ（省略で先頭）',autocomplete:true},{type:4,name:'page',description:'PR・Issueのページ番号',min_value:1,max_value:100}]:[]}))}];
function readConfig(){const c=JSON.parse(fs.readFileSync(path.join(DATA,'discord-command-config.json'),'utf8'));if(!c.commands||!Array.isArray(c.allowedRoleIds)||!Array.isArray(c.allowedUserIds)||!Array.isArray(c.allowedChannelIds)||!Array.isArray(c.repositories))throw new Error('Invalid settings');return c;}
function roleIds(interaction){const roles=interaction.member?.roles;return Array.isArray(roles)?roles:[...(roles?.cache?.keys()||[])];}
function allowed(config,interaction,command){
 const p=config.commands?.[command];if(interaction.guildId!==GUILD||!config.enabled||!p?.enabled||(command==='logs'&&!config.allowLogs))return false;
 const individual=Boolean(p.roleIds?.length||p.userIds?.length);const roles=individual?p.roleIds:config.allowedRoleIds,users=individual?p.userIds:config.allowedUserIds,channels=p.channelIds?.length?p.channelIds:config.allowedChannelIds;
 return Array.isArray(roles)&&Array.isArray(users)&&Array.isArray(channels)&&channels.includes(interaction.channelId)&&(users.includes(interaction.user.id)||roleIds(interaction).some(id=>roles.includes(id)));
}
function run(args){return new Promise((resolve,reject)=>execFile('/usr/bin/python3',[HELPER,...args],{timeout:45000,maxBuffer:200000,env:{...process.env,TAYUNET_MONITOR_DATA:DATA,PATH:'/home/yoshi/.nvm/versions/node/v24.15.0/bin:/home/yoshi/.local/bin:/usr/bin:/bin'}},(error,stdout)=>{if(error)return reject(new Error('取得処理が完了しませんでした。管理画面で状態を確認してください。'));try{resolve(JSON.parse(stdout));}catch{reject(new Error('応答の形式が正しくありません。'));}}));}
function chunks(text){const parts=[];let part='';for(const line of String(text).split('\n')){let remaining=line;while(remaining.length>1800){if(part){parts.push(part);part='';}parts.push(remaining.slice(0,1800));remaining=remaining.slice(1800);}if(part.length+remaining.length+1>1800){parts.push(part);part='';}part+=(part?'\n':'')+remaining;}if(part)parts.push(part);return parts.length?parts:['データはありません。'];}
function createHandler({loadConfig=readConfig,worker=run,now=Date.now,onError=()=>{},onResponse=()=>{}}={}){
 const cooldowns=new Map();let busy=0;
 return async interaction=>{
  if(interaction.commandName!=='ubuntu')return;
  const autocomplete=interaction.isAutocomplete?.();
  if(!autocomplete&&!interaction.isChatInputCommand?.())return;
  let config,command;
  try{config=loadConfig();command=interaction.options.getSubcommand();}catch{if(autocomplete)return interaction.respond([]);return interaction.reply({content:'設定を読み取れません。管理画面を確認してください。',flags:64,allowedMentions:{parse:[]}});}
  if(autocomplete){if(!allowed(config,interaction,'github'))return interaction.respond([]);const q=String(interaction.options.getFocused()||'').toLowerCase();return interaction.respond(config.repositories.filter(x=>x.enabled&&x.name.toLowerCase().includes(q)).slice(0,25).map(x=>({name:x.name,value:x.name})));}
  const base=['--actor',interaction.user.id,'--channel',interaction.channelId,'--guild',interaction.guildId||'','--roles',roleIds(interaction).join(',')];
  const key=interaction.user.id+':'+command;
  const seconds=config.commands?.[command]?.cooldownSeconds??config.cooldownSeconds??15;
  const remaining=(cooldowns.get(key)||0)-now();
  if(!allowed(config,interaction,command)||remaining>0||busy>=3){worker(['denied',...base]).catch(()=>{});return interaction.reply({content:remaining>0?`連続実行を防ぐため、あと${Math.ceil(remaining/1000)}秒お待ちください。`:busy>=3?'他の確認処理が実行中です。少し待って再試行してください。':'この場所・権限では実行できないか、機能が停止中です。',flags:64,allowedMentions:{parse:[]}});}
  cooldowns.set(key,now()+seconds*1000);busy++;
  try{
   await interaction.deferReply();
   const args=[command,...base];
   if(command==='logs')args.push('--target',interaction.options.getString('target')||'');
   if(command==='github')args.push('--view',interaction.options.getString('view')||'summary','--repository',interaction.options.getString('repository')||'','--page',String(interaction.options.getInteger('page')||1));
   const result=await worker(args);const parts=chunks(result.text||'データはありません。').map(part=>command==='logs'?'```text\n'+part.replace(/```/g,'~~~')+'\n```':part);
   await interaction.editReply({content:parts[0],allowedMentions:{parse:[]}});
   for(const content of parts.slice(1,8))await interaction.followUp({content,allowedMentions:{parse:[]}});
   onResponse({at:new Date().toISOString(),command,ok:result.ok!==false});
   if(parts.length>8)await interaction.followUp({content:'表示量が多いため残りを省略しました。項目やページを絞って確認してください。',allowedMentions:{parse:[]}});
  }catch(error){onError({at:new Date().toISOString(),command,message:'確認処理またはDiscordへの返信に失敗しました。',type:error.name});const message='取得失敗: 確認処理またはDiscordへの返信に失敗しました。管理画面の状態を確認してください。';try{if(interaction.deferred)await interaction.editReply({content:message,allowedMentions:{parse:[]}});else await interaction.reply({content:message,flags:64,allowedMentions:{parse:[]}});}catch{}}
  finally{busy--;}
 };
}
function init(client){
 const recentErrors=[];let lastCommand=null;const startedAt=new Date().toISOString();let previous=null;try{previous=JSON.parse(fs.readFileSync(path.join(DATA,'discord-bot-last-exit.json'),'utf8'));}catch{}
 let packageVersion='未確認';try{packageVersion=JSON.parse(fs.readFileSync(path.join(__dirname,'..','package.json'),'utf8')).version||'未確認';}catch{}
 function write(){try{let config=null,error=null;try{config=readConfig();}catch{error='設定を読み取れません';}const body={pid:process.pid,startedAt,uptimeSeconds:Math.floor(process.uptime()),heartbeatAt:new Date().toISOString(),ready:client.isReady(),pingMs:Number.isFinite(client.ws.ping)&&client.ws.ping>=0?client.ws.ping:null,nodeVersion:process.version,botVersion:packageVersion,operationsVersion:'1',memory:process.memoryUsage(),configRevision:config?.revision||null,configError:error,previousExit:previous,recentErrors,lastCommand};const tmp=path.join(DATA,'discord-bot-heartbeat.tmp');fs.writeFileSync(tmp,JSON.stringify(body),{mode:0o600});fs.renameSync(tmp,path.join(DATA,'discord-bot-heartbeat.json'));}catch{console.error('[UbuntuCommands] heartbeat write failed');}}
 let reason='正常終了';process.on('uncaughtExceptionMonitor',error=>{reason='未処理の例外: '+error.name;});process.on('exit',code=>{try{fs.writeFileSync(path.join(DATA,'discord-bot-last-exit.json'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,code,reason}),{mode:0o600});}catch{}});
 client.on('interactionCreate',createHandler({onError:entry=>{recentErrors.unshift(entry);recentErrors.splice(10);write();},onResponse:entry=>{lastCommand=entry;write();}}));client.once('ready',write);const timer=setInterval(write,30000);timer.unref();
}
module.exports={commands,init,createHandler,allowed,chunks};
