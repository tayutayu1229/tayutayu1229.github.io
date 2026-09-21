const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('T-time/ekibetuatos.html', 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .find(source => source.includes('function sameStation'));
assert.ok(script, '駅名照合処理が見つかりません');

const start = script.indexOf('function safeVal');
const end = script.indexOf('function autoDeterminePower');
const context = vm.createContext({});
vm.runInContext(script.slice(start, end), context);

assert.equal(context.sameStation('　蕨　', '蕨'), true, '一文字駅名の表示用空白を無視する');
assert.equal(context.sameStation('蕨', '　蕨'), true, '選択値側の空白も無視する');
assert.equal(context.sameStation('大　宮', '大宮'), true, '既存の均等割付駅名も照合できる');
assert.equal(context.sameStation('蕨', '巣鴨'), false, '別駅を同一視しない');
assert.equal(context.sameStation('', ''), false, '空欄同士は駅として照合しない');

assert.match(html, /stops\.some\(s => sameStation\(s\.station, station\)\)/);
assert.match(html, /stops\.find\(st => sameStation\(st\.station, station\)\)/);
console.log('station timetable name matching: ok');
