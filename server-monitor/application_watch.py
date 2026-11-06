"""Operational error monitoring. Never persist or notify raw application logs."""
import json
import re
import sqlite3
import subprocess
import time
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

QUIET_SECONDS = 600
LIMIT = 262144
ERRORS = [
 ('discord-permission', re.compile(r'Missing Permissions|\b50013\b|Missing Access'), 'Discordへの送信権限がありません。対象Botの閲覧・送信・埋め込み・添付権限を確認してください。'),
 ('database', re.compile(r'SQLITE_(?:CORRUPT|IOERR|FULL)|database is locked|disk I/O error|could not connect to (?:server|database)', re.I), 'データの保存・取得処理で異常を検知しました。DBの稼働・空き容量・バックアップ状況を確認してください。'),
 ('network', re.compile(r'ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed|TimeoutError|connection timed out', re.I), '外部接続または内部通信に失敗しました。取得先の稼働とネットワークを確認してください。'),
 ('server-error', re.compile(r'HTTP[ /:=]+5\d\d|status(?:Code)?["\s:=]+5\d\d|\"status\"\s*:\s*5\d\d', re.I), 'サーバー処理で500番台のエラーが発生しました。サービスの稼働状況と直近ログを確認してください。'),
 ('runtime', re.compile(r'\[エラー\]|(?:^|\s)(?:ERROR|FATAL)(?:\s|:|\])|Traceback \(most recent call last\)|Unhandled(?:PromiseRejection| exception| rejection)|uncaughtException', re.I), '処理中のエラーを検知しました。取得・保存・配信が完了していない可能性があります。管理画面の稼働状況と直近ログを確認してください。'),
]

def stamp(now):
 return datetime.fromtimestamp(now, timezone.utc).isoformat()

def classify(text):
 # Error descriptions are fixed strings: no tokens, user content or stack traces.
 found={key:message for key,pattern,message in ERRORS if pattern.search(text)}
 if len(found)>1:found.pop('runtime',None)
 return found

def connect(path):
 db=sqlite3.connect(path,timeout=15);db.row_factory=sqlite3.Row
 db.executescript('''CREATE TABLE IF NOT EXISTS application_watch_state(
 key TEXT PRIMARY KEY, active INTEGER NOT NULL, seen_at REAL NOT NULL, message TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS application_watch_cursor(
 key TEXT PRIMARY KEY, value TEXT NOT NULL);
 ''');return db

SERVICE_LABELS = {
 'tayunet-photo-archive':'撮影記録・撮影地システム','jreast-press-bot-press-release-bot-1':'JR東日本プレス通知',
 'press':'JR東日本プレス通知','tayunet-managed-db-api':'輸送障害・旧会計・車両運用の共通API',
 'incident-share':'事象共有システム','atos-delay-history':'遅延履歴システム',
 'file-api':'保護データAPI','filet-main':'ファイル転送','flight-alert':'航空情報',
 'timetable-app':'時刻表システム','jre-issei':'JR一斉配信','jre-discord-voice':'Discord音声配信',
 'tokyo-discord-bot':'Discord管理Bot','managed-db':'移行DBのバックアップ'}
def readable_target(key):
 parts=key.split(':')
 if parts[:2]==['application','watch']:
  name=parts[3] if len(parts)>3 and parts[2] in ['docker','pm2'] else parts[-1]
  return SERVICE_LABELS.get(name,name)+'のログ監視'
 if len(parts)>2 and parts[1]=='browser':return '画面の動作確認（'+parts[2]+'）'
 return SERVICE_LABELS.get(parts[1],parts[1])+'の状態確認'

def observe(db,key,failed,message,record,now,recovery='状態が正常に戻ったことを確認しました。'):
 previous=db.execute('SELECT * FROM application_watch_state WHERE key=?',(key,)).fetchone()
 if failed and (not previous or not previous['active']):
  record('warning' if key.startswith('application:watch:') else 'critical',key,('監視範囲の注意: ' if key.startswith('application:watch:') else '処理異常: ')+message,notify=True,db=db)
 elif not failed and previous and previous['active']:
  record('ok','recovered:'+key,('監視の再開: '+readable_target(key)+'\nログを通常どおり確認できる状態に戻りました。' if key.startswith('application:watch:') else '復旧確認: '+readable_target(key)+'\n'+recovery),notify=True,db=db)
 db.execute('INSERT OR REPLACE INTO application_watch_state VALUES(?,?,?,?)',(key,int(failed),now,message))

def file_chunk(path,cursor):
 try:
  p=Path(path);stat=p.stat();identity=str(stat.st_ino)
  old=json.loads(cursor) if cursor else None
  if not old:return '',json.dumps({'inode':identity,'offset':stat.st_size}),None
  offset=old['offset'] if old['inode']==identity and old['offset']<=stat.st_size else 0
  gap=stat.st_size-offset>LIMIT
  start=max(offset,stat.st_size-LIMIT)
  with p.open('rb') as f:
   f.seek(start);data=f.read(LIMIT)
  # Discard an incomplete trailing line until the next collection.
  end=data.rfind(b'\n')+1
  if gap and end:data=data[data.find(b'\n')+1:end]
  else:data=data[:end]
  return data.decode('utf8','replace'),json.dumps({'inode':identity,'offset':start+end}),('ログ量が監視上限を超えたため、一部の行を確認できませんでした。' if gap else None)
 except (OSError,ValueError,KeyError,TypeError):
  return '',cursor,'ログファイルの読み取りに失敗しました。'

def docker_chunk(name,cursor,now,run):
 if not cursor:return '',stamp(now),None
 code,text=run(['docker','logs','--timestamps','--since',cursor,'--until',stamp(now),'--tail','200',name],timeout=6)
 if code:return '',cursor,'コンテナログの読み取りに失敗しました。'
 gap=len(text.encode())>LIMIT or len(text.splitlines())>=200
 return text[-LIMIT:],stamp(now),('ログ量が監視上限を超えたため、一部の行を確認できませんでした。' if gap else None)

PRESS_PROBE = r'''
const fs=require('fs');
(async()=>{
 const state=JSON.parse(fs.readFileSync(process.env.STATE_FILE||'/app/data/state.json','utf8'));
 const feedResponse=await fetch(process.env.PRESS_RELEASE_URL||'https://jreissei.tayunet-traininfo.com/json/press-releases.json',{signal:AbortSignal.timeout(7000)});
 if(!feedResponse.ok)throw Error('feed unavailable');const feed=await feedResponse.json();
 if(!Array.isArray(feed.items)||!Array.isArray(state.seenIds))throw Error('invalid press state');
 const headers={Authorization:'Bot '+process.env.DISCORD_BOT_TOKEN};
 const api=async p=>{const r=await fetch('https://discord.com/api/v10'+p,{headers,signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error('Discord status '+r.status);return r.json();};
 const guild=process.env.DISCORD_GUILD_ID||'1489628881106243664',channel=process.env.DISCORD_CHANNEL_ID||'1527140995144220752';
 const me=await api('/users/@me');const [c,m,roles]=await Promise.all([api('/channels/'+channel),api('/guilds/'+guild+'/members/'+me.id),api('/guilds/'+guild+'/roles')]);
 let p=roles.filter(r=>r.id===guild||m.roles.includes(r.id)).reduce((v,r)=>v|BigInt(r.permissions),0n);
 if(!(p&8n)){
  const everyone=c.permission_overwrites.find(o=>o.id===guild);if(everyone)p=(p&~BigInt(everyone.deny))|BigInt(everyone.allow);
  const rs=c.permission_overwrites.filter(o=>o.type===0&&m.roles.includes(o.id));p=(p&~rs.reduce((v,o)=>v|BigInt(o.deny),0n))|rs.reduce((v,o)=>v|BigInt(o.allow),0n);
  const own=c.permission_overwrites.find(o=>o.id===me.id);if(own)p=(p&~BigInt(own.deny))|BigInt(own.allow);
 }
 const seen=new Set(state.seenIds);const pending=feed.items.filter(i=>!seen.has(i.id)).length;
 const missing=(p&8n)?[]:[['閲覧',1024n],['送信',2048n],['埋め込み',16384n],['添付',32768n]].filter(([,bit])=>!(p&bit)).map(([n])=>n);
 console.log(JSON.stringify({pending,missing,feedAt:feed.fetchedAt,lastSuccess:state.lastSuccessfulFetchAt}));
})().catch(()=>{console.log(JSON.stringify({probeError:true}));});
'''

def press_check(db,run,record,now,probe_result=None):
 # Permission failures should be detected even when no release is waiting.
 key='probe:press';row=db.execute('SELECT value FROM application_watch_cursor WHERE key=?',(key,)).fetchone()
 if row and now-float(row[0])<120:return
 code,text=probe_result if probe_result is not None else run(['docker','exec','jreast-press-bot-press-release-bot-1','node','-e',PRESS_PROBE],timeout=20)
 try:
  if code:raise ValueError()
  data=json.loads(text)
  if data.get('probeError'):raise ValueError()
  if type(data['pending']) is not int or not isinstance(data['missing'],list):raise ValueError()
 except (ValueError,KeyError,TypeError):
  observe(db,'application:press:probe',True,'プレス通知の取得・配信状態を確認できません。Botと取得先の接続を確認してください。',record,now)
  return
 observe(db,'application:press:probe',False,'プレス通知の状態確認',record,now)
 observe(db,'application:press:discord-permission',bool(data['missing']),'プレス通知のDiscord権限が不足しています。Botの閲覧・送信・埋め込み・添付権限を確認してください。',record,now,recovery='プレス通知Botの閲覧・送信・埋め込み・添付権限が正常に戻りました。')
 try:stale=now-datetime.fromisoformat(data['feedAt'].replace('Z','+00:00')).timestamp()>1800
 except (ValueError,KeyError,AttributeError):stale=True
 observe(db,'application:press:stale-feed',stale,'プレスリリースの取得元データが30分以上更新されていません。取得処理を確認してください。',record,now)
 pending_key='press:pending-since';row=db.execute('SELECT value FROM application_watch_cursor WHERE key=?',(pending_key,)).fetchone()
 since=float(row[0]) if row else now
 if data['pending']:
  db.execute('INSERT OR IGNORE INTO application_watch_cursor VALUES(?,?)',(pending_key,str(now)))
 else:db.execute('DELETE FROM application_watch_cursor WHERE key=?',(pending_key,))
 if not data['missing'] or not data['pending']:
  observe(db,'application:press:backlog',bool(data['pending'] and now-since>=180),'プレス通知の未配信記事が3分以上残っています。Discord配信とPDF変換処理を確認してください。',record,now)
 db.execute('INSERT OR REPLACE INTO application_watch_cursor VALUES(?,?)',(key,str(now)))

def managed_backup_check(db,record,now,root=Path('/home/yoshi/services/tayunet-managed-db')):
 try:
  status=json.loads((root/'backup-status.json').read_text());age=now-datetime.fromisoformat(status['finishedAt']).timestamp()
  failed=status.get('ok') is not True or age>36*3600 or age < -300
 except (OSError,ValueError,KeyError,TypeError):failed=True
 observe(db,'application:managed-db:backup',failed,'移行3DBのバックアップが失敗・未記録、または36時間以上更新されていません。バックアップ処理とHDD容量を確認してください。',record,now)

def poll(directory,db_path,record,run,pm2_bin,pm2_names,docker_names,now=None):
 now=time.time() if now is None else now
 with closing(connect(db_path)) as db,db:
  sources=[];pm2_error=False
  code,text=run([pm2_bin,'jlist'],timeout=15)
  try:
   if code:raise ValueError()
   processes=json.loads(text)
   for process in processes:
    name=process.get('name');env=process.get('pm2_env',{})
    if name not in pm2_names:continue
    for kind in ['out','err']:
     path=env.get('pm_'+kind+'_log_path')
     if path:sources.append(('file','pm2:'+name+':'+kind,name,path))
   pm2_error=False
  except (ValueError,TypeError,AttributeError):
   pm2_error=True
  sources.extend(('docker','docker:'+name,name,name) for name in sorted(docker_names))
  backup_log=Path('/home/yoshi/services/tayunet-managed-db/backup.log')
  if backup_log.exists():sources.append(('file','managed-backup','managed-db-backup',str(backup_log)))
  cursors={row['key']:row['value'] for row in db.execute('SELECT * FROM application_watch_cursor')}
  def read(source):
   kind,key,name,path=source
   content,cursor,error=file_chunk(path,cursors.get(key)) if kind=='file' else docker_chunk(path,cursors.get(key),now,run)
   return source,content,cursor,error
  with ThreadPoolExecutor(max_workers=4) as pool:reads=list(pool.map(read,sources))
  press_due='probe:press' not in cursors or now-float(cursors['probe:press'])>=120
  press_result=run(['docker','exec','jreast-press-bot-press-release-bot-1','node','-e',PRESS_PROBE],timeout=20) if press_due else None
  # All network/process I/O above finishes before obtaining the DB write lock.
  db.execute('BEGIN IMMEDIATE')
  observe(db,'application:watch:pm2',pm2_error,'PM2アプリケーションログの一覧取得・監視',record,now)
  for source,content,cursor,error in reads:
   kind,key,name,path=source
   observe(db,'application:watch:'+key,bool(error),SERVICE_LABELS.get(name,name)+' のログ監視: '+(error+' サービスの停止を示す通知ではありません。' if error else '読取正常'),record,now)
   # Permission logs and permission probes share one incident identity.
   app='press' if name=='jreast-press-bot-press-release-bot-1' else name
   labels={'jrchr':'輸送障害JRchr','operations':'車両運用','database_admin':'データ管理','timetable':'時刻表','incident_share':'事象共有','photo':'撮影記録','finance':'会計','railway_tools':'鉄道業務画面','admin':'システム管理','portal':'ポータル'}
   for system,category in set(re.findall(r'ClientError system=([a-z_]+) kind=(service_error|javascript_error)',content)):
    if system in labels:
     message=labels[system]+('のデータ読み込みに失敗しました。APIの稼働状況を確認してください。' if category=='service_error' else 'の画面処理で重大なエラーを検知しました。公開版とブラウザのエラー記録を確認してください。')
     observe(db,'application:browser:'+system+':'+category,True,message,record,now)
   for category,message in classify(content).items():
    observe(db,'application:'+app+':'+category,True,name+': '+message,record,now)
   if cursor is not None:db.execute('INSERT OR REPLACE INTO application_watch_cursor VALUES(?,?)',(key,cursor))
  press_check(db,run,record,now,press_result)
  managed_backup_check(db,record,now)
  # Log silence alone is not proof of recovery. State exactly what was observed.
  for row in db.execute("SELECT * FROM application_watch_state WHERE active=1 AND seen_at<?",(now-QUIET_SECONDS,)).fetchall():
   if any(row['key'].endswith(':'+key) for key in [*[k for k,_,_ in ERRORS],'service_error','javascript_error']) and not row['key'].startswith('application:press:'):
    record('info','quiet:'+row['key'],'新規エラーの再発を直近10分間観測していません: '+row['message']+'\n原因の解消や操作成功を保証する通知ではありません。',notify=True,db=db)
    db.execute('UPDATE application_watch_state SET active=0 WHERE key=?',(row['key'],))
  # Press generic failures also need a quiet notice, not a false recovery.
  for row in db.execute("SELECT * FROM application_watch_state WHERE active=1 AND seen_at<? AND key IN ('application:press:runtime','application:press:network','application:press:server-error')",(now-QUIET_SECONDS,)).fetchall():
   record('info','quiet:'+row['key'],'プレス通知の新規実行エラーを直近10分間観測していません。配信権限・未配信記事は別に継続監視します。',notify=True,db=db)
   db.execute('UPDATE application_watch_state SET active=0 WHERE key=?',(row['key'],))
  return {'sources':len(sources),'active':db.execute('SELECT count(*) FROM application_watch_state WHERE active=1').fetchone()[0],'checkedAt':stamp(now),'alerts':[{'code':row['key'],'severity':'warning' if row['key'].startswith('application:watch:') else 'critical','message':row['message']} for row in db.execute('SELECT key,message FROM application_watch_state WHERE active=1')]}
