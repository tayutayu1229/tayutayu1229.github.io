const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'kitaku-bus/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'kitaku-bus/app.js'), 'utf8');
const top = fs.readFileSync(path.join(root, 'toppage.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'kitaku-bus/data.json'), 'utf8'));

assert(top.includes('href="kitaku-bus/"'), 'トップページからバス案内を開けません');
assert(page.includes('現在地から探す') && page.includes('停留所を検索'), '主要な検索操作がありません');
assert(page.includes('リアルタイム情報ではありません'), '計画時刻であることの注意書きがありません');
assert(script.includes("timeZone: 'Asia/Tokyo'"), '運行日判定が日本時間に固定されていません');
assert.strictEqual(data.meta.license, 'CC BY 4.0');
assert.strictEqual(data.meta.endDate, '20270331');
assert(data.stops.length >= 30, '停留所が不足しています');
assert(data.stops.some(stop => stop.name === '北区役所'), '北区役所停留所がありません');
assert(data.stops.some(stop => stop.name === '宮原駅東口'), '宮原駅東口がありません');
assert(data.stops.some(stop => stop.name === '宮原駅西口'), '宮原駅西口がありません');
assert.deepStrictEqual(Object.keys(data.shapes).sort(), ['SHP0001', 'SHP0002']);
assert(Object.values(data.shapes).every(shape => shape.length > 100), '路線形状が不足しています');
assert(data.stops.flatMap(stop => stop.departures).every(item => /^\d{2}:\d{2}$/.test(item.time)), '時刻形式が不正です');

console.log(`kitaku bus audit: ok (${data.stops.length} stops)`);
