const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {L: {tileLayer(url, options) {
  return {url, options, events: {}, on(name, callback) {this.events[name] = callback; return this;}, setUrl(url) {this.url = url;}};
}}};
vm.runInNewContext(fs.readFileSync('assets/js/base-map.js', 'utf8'), {window});
const layer = window.TayunetBaseMap.createLayer();
assert(layer.url.includes('/xyz/pale/'));
assert.equal(layer.options.maxNativeZoom, 18, '拡大時に配信範囲外のズームを要求しない');
assert(layer.options.attribution.includes('maps.gsi.go.jp'));
layer.events.tileerror();
layer.events.tileerror();
assert(layer.url.includes('gsi.go.jp'), '単発の失敗では切り替えない');
layer.events.tileload();
layer.events.tileerror();
assert(layer.url.includes('gsi.go.jp'), '正常取得後は失敗回数をリセット');
layer.events.tileerror();
layer.events.tileerror();
assert(layer.url.includes('tile.openstreetmap.org'));
assert(layer.options.attribution.includes('OpenStreetMap'));
layer.events.tileerror();
assert(layer.url.includes('tile.openstreetmap.org'), '通信失敗で配信元をループしない');
assert(window.TayunetBaseMap.createLayer('std').url.includes('/xyz/std/'));
for (const file of ['kitaku-bus/app.js', 'JRF_status/JRF-gtfs/app.js']) {
  const source = fs.readFileSync(file, 'utf8');
  assert(!source.includes('cartocdn.com'), 'APIキーを要求する地図を使わない');
  assert(source.includes('TayunetBaseMap.createLayer'));
}
console.log('base map fallback: ok');
