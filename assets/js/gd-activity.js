(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TayunetGdActivity = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const key = value => String(value || '').replace(/[\s　]/g, '').toLowerCase();
  const labels = {operate:'運転',changed:'時刻変更',cancelled:'当日運休',prohibited:'運転禁止',unknown:'未判定'};
  const styles = {operate:'',changed:'',cancelled:'stroke:#c00000;stroke-width:2;stroke-dasharray:none',prohibited:'',unknown:''};
  const signature = stop => JSON.stringify([key(stop.station),stop.arrival || '',stop.departure || '']);
  function project(train, payload, date, stationKey = key) {
    if (!payload || payload.serviceDate !== date) throw new Error('指定日の活休情報を取得できていません。');
    if (train.operationServiceDate && train.operationServiceDate !== date) return [];
    const item = payload.items.find(value => key(value.trainNumber) === key(train.trainNumber));
    if (!item && train.source === 'operation-service') return [];
    const original = train.stops || [], source = item?.stops || [];
    const names = source.map(stop => stationKey(stop.station)), pieces = [];
    let mergeAllowed = true;
    const trainKey = [key(train.trainNumber),train.line,train.startDate,train.origin,train.destination].join('|');
    function add(pair, state, cancelledAt = '') {
      if (state === 'hidden' || state === 'suspend') { mergeAllowed = false; return; }
      if (!Object.hasOwn(labels,state)) state = 'unknown';
      if (item) pair = pair.map(stop => ({...stop, ...Object.fromEntries(['arrival','departure'].map(field =>
        [field,String(stop[field] || '').replace(/^[#$¥￥＄]+/, '')]))}));
      const style = state === 'operate' && (item ? item.timeChanged : pair.some(stop => /^#/.test(stop.arrival || '') || /^#/.test(stop.departure || ''))) ? 'changed' : state;
      const start = {...pair[0],arrival:''}, end = {...pair[1],departure:''};
      const previous = pieces.at(-1);
      if (mergeAllowed && previous && previous.gdState === style && previous.gdCancelledAt === cancelledAt && previous.lastStop === signature(pair[0])) {
        const boundary = previous.stops.at(-1);
        previous.stops[previous.stops.length - 1] = {...boundary,...start,arrival:boundary.arrival};
        previous.stops.push(end); previous.lastStop = signature(pair[1]);
        previous.gdDetailStops.push({...pair[1]});
      } else pieces.push({...train,stops:[start,end],gdDetailStops:pair.map(stop=>({...stop})),
        gdDeclaredStart:item?.sectionStart || '',gdDeclaredEnd:item?.sectionEnd || '',
        gdAvailableStart:item?.availableStart || '',gdAvailableEnd:item?.availableEnd || '',
        gdState:style,gdCancelledAt:cancelledAt,gdTrainKey:trainKey,lastStop:signature(pair[1])});
      mergeAllowed = true;
    }
    for (let i = 0; i + 1 < original.length; i++) {
      const pair = original.slice(i,i + 2);
      if (!item) {
        const suspended = pair.some(stop => /^[\$＄]/.test(stop.station || '')) || /^[$＄]/.test(pair[0].departure || '') || /^[$＄]/.test(pair[1].arrival || '');
        const prohibited = /^[¥￥]/.test(pair[0].departure || '') || /^[¥￥]/.test(pair[1].arrival || '');
        add(pair, suspended ? 'hidden' : prohibited ? 'prohibited' : 'operate');
        continue;
      }
      if (!source.length) { add(pair,item.baseState); continue; }
      const start = names.indexOf(stationKey(pair[0].station)), end = names.indexOf(stationKey(pair[1].station));
      if (start < 0 || end <= start || names.lastIndexOf(names[start]) !== start || names.lastIndexOf(names[end]) !== end) {
        add(pair,item.baseState === 'hidden' ? 'hidden' : 'unknown'); continue;
      }
      for (let index = start; index < end; index++) {
        const edge = item.edges[index];
        if (!edge) { add(source.slice(index,index + 2),'unknown'); continue; }
        add(edge.state === 'cancelled' ? edge.previousStops : source.slice(index,index + 2),edge.state,edge.cancelledAt || '');
      }
    }
    return pieces.map(({lastStop,...piece}) => piece);
  }
  function routeLabel(train) {
    return train.gdDeclaredStart || train.gdDeclaredEnd
      ? `${train.gdDeclaredStart || '—'} ～ ${train.gdDeclaredEnd || '—'}（通達区間）`
      : `${train.origin || '—'} 〜 ${train.destination || '—'}`;
  }
  return {project,labels,styles,routeLabel};
});
