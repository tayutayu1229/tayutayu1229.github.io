const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.parent = null; }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  focus() {}
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
}
const body = new Element('body');
const document = {
  body,
  createElement: tag => new Element(tag),
  getElementById: id => {
    function find(node) { return node.id === id ? node : node.children.map(find).find(Boolean); }
    return find(body) || null;
  },
};
const window = {};
vm.runInNewContext(fs.readFileSync('T-time/yard-movement.js', 'utf8'), {window, document});

const data = [
  {trainNumber: '出9820M', type: '出区', line: '東海道貨物', destination: '国府津',
    yardMovement: {category: '出区', departureTime: '09:00:00', departureTrack: '入出区',
      viaTime: '09:06:00', viaTrack: '運', arrivalTime: '09:08:00', arrivalTrack: '８番'}},
  {trainNumber: '試9820M', type: '試電'},
  {trainNumber: '入9825M', type: '入区', line: '東海道貨物', origin: '国府津',
    yardMovement: {category: '入区', departureTime: '16:52:00', departureTrack: '８番',
      viaTime2: '16:58:00', viaTrack2: '御進１', arrivalTime: '17:00:00', arrivalTrack: '入出区'}}
];
assert.equal(window.TayunetYardMovement.isYardMovement(data[0]), true);
assert.equal(window.TayunetYardMovement.isYardMovement(data[1]), false);
assert.equal(window.TayunetYardMovement.open(data[0], '2026/09/20'), true);
const text = node => [node.textContent || '', ...node.children.map(text)].join(' ');
assert.match(text(body), /出9820M/);
assert.match(text(body), /09:06:00/);
assert.match(text(body), /入出区/);
assert.equal(window.TayunetYardMovement.open(data.at(-1), '2026/09/20'), true);
assert.equal(body.children.length, 1, '新しい入出区画面を開くと前の画面を閉じる');
assert.match(text(body), /16:58:00/);
assert.match(text(body), /17:00:00/);
const close = document.getElementById('yardDialogBackdrop').children[0].children[0];
close.listeners.click();
assert.equal(body.children.length, 0);

for (const file of ['T-time/webatos.html', 'T-time/mobileatos.html', 'atosweb.html']) {
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /yard-movement\.js/);
  assert.match(html, /TayunetYardMovement.*open/);
}
console.log('yard movement: ok');
