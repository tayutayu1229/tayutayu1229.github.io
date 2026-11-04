const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({document: {getElementById: () => ({value: '2026-11-04'})}, window: {addEventListener() {}}, console, Date});
const source = fs.readFileSync('JRF_status/JRF-gtfs/app.js', 'utf8').replace(/\ninit\(\);\s*$/, '');
vm.runInContext(source, context);
vm.runInContext(`
  state.status = {ok: true, proxiedAt: new Date().toISOString(), trains: [
    {service:'3日発1055列車(東京タ→福岡タ)', trainNumbers:['1055'], departureDate:'2026-11-03', status:'+5時間', location:'終着'},
    {service:'4日発1055列車(東京タ→福岡タ)', trainNumbers:['1055'], departureDate:'2026-11-04', status:'+1時間2分', location:'吹田タ'},
  ]};
`, context);
assert.equal(vm.runInContext("delayMinutes({trip:['a_b_01055']})", context), 62, '異なる出発日の大きな遅れを混ぜない');
assert.equal(vm.runInContext("delayRecord({trip:['a_b_01055b']})", context), null, '同じ数字のトラック便に列車遅延を反映しない');
vm.runInContext('state.status.proxiedAt = new Date(Date.now()-3*60*60*1000).toISOString()', context);
assert.equal(vm.runInContext("delayRecord({trip:['a_b_01055']})", context), null, '更新が止まった情報を到着見込へ反映しない');
vm.runInContext('state.status.proxiedAt = new Date().toISOString(); state.status.stale=true', context);
assert.equal(vm.runInContext("delayRecord({trip:['a_b_01055']})", context), null, '取得失敗後の前回データを現在の遅延として扱わない');
console.log('freight status date and freshness: ok');
