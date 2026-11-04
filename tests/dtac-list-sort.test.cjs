const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const context=vm.createContext({Intl,document:{addEventListener(){}}});
vm.runInContext(fs.readFileSync('JREgyoumu/D-TAC/train_list.js','utf8'),context);
const sort=context.sortTrainGroups;
const numbers=groups=>Array.from(groups,g=>g[0].trainNumber);
test('date sort compares actual dates across padding and separators',()=>{
 const groups=[['2026/10/1','10'],['2026-02-10','2'],['2025/12/31','1']].map(([startDate,trainNumber])=>[{startDate,trainNumber}]);
 assert.deepEqual(numbers(sort(groups,'date','ascending')),['1','2','10']);
 assert.deepEqual(numbers(sort(groups,'date','descending')),['10','2','1']);
});
test('train numbers sort naturally including fullwidth digits',()=>{
 const groups=['10M','２M','1M'].map(trainNumber=>[{trainNumber}]);
 assert.deepEqual(numbers(sort(groups,'number','ascending')),['1M','２M','10M']);
 assert.deepEqual(numbers(sort(groups,'number','descending')),['10M','２M','1M']);
});
test('empty and unselected types stay last in either direction',()=>{
 const groups=[{type:'選択なし',trainNumber:'blank'},{type:'B',trainNumber:'b'},{type:'A',trainNumber:'a'}].map(t=>[t]);
 assert.deepEqual(numbers(sort(groups,'type','ascending')),['a','b','blank']);
 assert.deepEqual(numbers(sort(groups,'type','descending')),['b','a','blank']);
});
test('route sort includes both origin and destination',()=>{
 const groups=[{origin:'A',destination:'C',trainNumber:'c'},{origin:'B',destination:'A',trainNumber:'b'},{origin:'A',destination:'B',trainNumber:'a'}].map(t=>[t]);
 assert.deepEqual(numbers(sort(groups,'route','ascending')),['a','c','b']);
 assert.deepEqual(numbers(sort(groups,'route','descending')),['b','c','a']);
});
test('sorting preserves whole route segments, stable ties and source order',()=>{
 const first=[{trainNumber:'2M'},{trainNumber:'2M',line:'second segment'}];
 const second=[{trainNumber:'1M'}],same=[{trainNumber:'2M'}];
 const groups=[first,second,same];
 const result=sort(groups,'number','ascending');
 assert.equal(result[0],second);assert.equal(result[1],first);assert.equal(result[2],same);
 assert.equal(result[1].length,2);assert.equal(groups[0],first);
 assert.deepEqual(Array.from(sort(groups,null,'ascending')),groups);
});
