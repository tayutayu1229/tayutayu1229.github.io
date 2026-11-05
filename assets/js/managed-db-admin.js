(async function(){
 'use strict';
 const $=id=>document.getElementById(id),api=window.TayunetManagedDb;
 const labels={incidents:'輸送障害',users:'旧利用者',payments:'会費・入金',expenses:'支出',budgets:'予算',summary_notes:'年度のメモ',diagrams:'ダイヤ改正',duties:'所定運用',duty_trains:'所定運用の列車',extra_duties:'臨時運用',extra_duty_trains:'臨時運用の列車',duty_with_trains:'運用と列車の結合一覧'};
 const fields={id:'番号',title:'件名',datetime:'発生日時',location:'場所',trainNo:'列車番号',data:'詳細データ',user_id:'利用者ID',email:'メールアドレス',year:'年度',status:'状態',paid_at:'支払日時',amount:'金額',next_due_date:'次回期日',created_at:'作成日時',expense_date:'支出日時',note:'メモ',next_update_date:'次回更新日',category:'項目',updated_at:'更新日時',name:'名称',revision_date:'改正日',notes:'備考',diagram_id:'ダイヤ改正番号',duty_number:'運用番号',depot:'区所',vehicle_type:'車種',successor_text:'後運用の説明',successor_duty_id:'後運用番号',successor_type:'後運用の区分',predecessor_text:'前運用の説明',duty_id:'所定運用の番号',order:'表示順',train_number:'列車番号',origin:'始発駅',destination:'終着駅',remarks:'記事',date:'施行日',base_duty_id:'元の運用番号',extra_duty_id:'臨時運用の番号'};
 let catalog,rows=[],table,editing=null,requestVersion=0;
 const status=(text,error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error);};
 const project=()=>catalog.projects.find(p=>p.id===$('project').value);
 const endpoint=()=>`/${project().id}/rest/v1/${table.name}`;
 function option(value,text){const o=document.createElement('option');o.value=value;o.textContent=text;return o;}
 function stringify(value){if(value===null||value===undefined)return '';return typeof value==='object'?JSON.stringify(value):String(value);}
 function render(){
  const query=$('filter').value.toLowerCase();const filtered=rows.filter(row=>Object.values(row).some(value=>stringify(value).toLowerCase().includes(query)));
  $('count').textContent=`${filtered.length}件を表示 / 取得${rows.length}件（最大5,000件）`;
  const tr=document.createElement('tr');
  for(const column of table.columns){const th=document.createElement('th');th.textContent=fields[column.name]||column.name;tr.append(th);}
  if(!table.readOnly){const th=document.createElement('th');th.textContent='操作';tr.append(th);}$('head').replaceChildren(tr);
  const fragment=document.createDocumentFragment();
  for(const row of filtered){const tr=document.createElement('tr');
   for(const column of table.columns){const td=document.createElement('td');const text=stringify(row[column.name]);td.textContent=text.length>160?text.slice(0,160)+'…':text;tr.append(td);}
   if(!table.readOnly){const td=document.createElement('td');td.className='action';
    const edit=document.createElement('button');edit.textContent='編集';edit.onclick=()=>open(row);
    const del=document.createElement('button');del.textContent='削除';del.className='delete';del.onclick=()=>remove(row);
    td.append(edit,del);tr.append(td);
   }fragment.append(tr);
  }$('rows').replaceChildren(fragment);
 }
 async function load(){
  const version=++requestVersion;table=project().tables.find(t=>t.name===$('table').value);
  $('title').textContent=labels[table.name]||table.name;$('add').disabled=table.readOnly;
  $('note').textContent=project().id==='accounting'?'旧tokyo-adminの会計データです。既存のFirebase会計データとは分けて保存しています。':table.readOnly?'この一覧は関連データから計算した参照用です。元の一覧から編集してください。':'';
  status('データを読み込んでいます…');
  try{const order=table.columns.some(c=>c.name==='id')?'id':table.columns[0].name;const result=await api.request(endpoint()+'?select=*&limit=5000&order='+encodeURIComponent(order)+'.asc');if(version!==requestVersion)return;rows=result;render();status('最新のデータを読み込みました。');}
  catch(error){if(version!==requestVersion)return;rows=[];$('rows').replaceChildren();status(error.message,true);}
 }
 function selectProject(){
  $('table').replaceChildren(...project().tables.map(t=>option(t.name,labels[t.name]||t.name)));load();
 }
 function open(row){
  editing=row;$('edit-title').textContent=row?'データを編集':'新しく追加';$('edit-error').textContent='';$('fields').replaceChildren();
  for(const column of table.columns){
   if(!row&&column.identity)continue;
   const label=document.createElement('label');label.textContent=fields[column.name]||column.name;
   const json=column.type==='jsonb'||column.type==='json';const long=json||['note','notes','remarks','data'].includes(column.name);
   const input=document.createElement(long?'textarea':'input');if(long)label.className='wide';
   input.dataset.column=column.name;input.dataset.type=column.type;input.value=row?(json?JSON.stringify(row[column.name],null,2):stringify(row[column.name])):'';
   if(column.name==='id')input.readOnly=true;
   if(!column.nullable&&!column.identity)input.required=true;
   if(column.type.includes('integer')||column.type==='bigint'||column.type==='numeric'){input.inputMode='decimal';}
   label.append(input);$('fields').append(label);
  }$('editor').showModal();
 }
 async function save(event){
  event.preventDefault();$('save').disabled=true;$('edit-error').textContent='';
  try{
   const body={};for(const input of $('fields').querySelectorAll('[data-column]')){
    if(input.dataset.column==='id')continue;
    const value=input.value.trim(),type=input.dataset.type;
    if(!editing&&!value)continue;
    if(!value){body[input.dataset.column]=null;continue;}
    if(type==='jsonb'||type==='json')body[input.dataset.column]=JSON.parse(value);
    else if(type.includes('integer')||type==='bigint'||type==='numeric'){
     const n=Number(value);if(!Number.isFinite(n)||(type.includes('integer')||type==='bigint')&&!Number.isSafeInteger(n))throw new Error('数値を正しく入力してください。');body[input.dataset.column]=n;
    }else if(type==='boolean'){
     if(!['true','false'].includes(value))throw new Error('真偽値はtrueまたはfalseで入力してください。');body[input.dataset.column]=value==='true';
    }else body[input.dataset.column]=input.value;
   }
   await api.request(endpoint()+(editing?'?id=eq.'+encodeURIComponent(editing.id):''),{method:editing?'PATCH':'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(body)});
   $('editor').close();await load();status('保存しました。');
  }catch(error){$('edit-error').textContent=error.message;}finally{$('save').disabled=false;}
 }
 async function remove(row){
  if(!confirm(`番号 ${row.id} のデータを削除します。関連するデータにも影響する場合があります。削除しますか？`))return;
  try{await api.request(endpoint()+'?id=eq.'+encodeURIComponent(row.id),{method:'DELETE'});await load();status('削除しました。');}catch(error){status(error.message,true);}
 }
 try{
  const ready=await api.context();const me=await api.request('/me');
  if(!me.isAdmin)throw new Error('この画面は管理者のみ利用できます。');
  $('account').textContent=ready.user.email||'管理者';catalog=await api.request('/catalog');
  $('project').replaceChildren(...catalog.projects.map(p=>option(p.id,p.name)));$('workspace').hidden=false;selectProject();
 }catch(error){status(error.message,true);return;}
 $('project').onchange=selectProject;$('table').onchange=load;$('reload').onclick=load;$('add').onclick=()=>open(null);$('filter').oninput=render;
 $('close').onclick=$('cancel').onclick=()=>$('editor').close();$('edit-form').onsubmit=save;
})();
