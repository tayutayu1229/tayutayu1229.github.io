'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync('assets/js/back-navigation.js', 'utf8');
function run(optOut) {
  const created = [], appended = [];
  vm.runInNewContext(script, {
    window: { location: { pathname:'/operation-service/daily-admin.html' } },
    document: {
      querySelector: selector => optOut && selector.includes('[data-no-site-back-navigation]') ? {} : null,
      querySelectorAll: () => [],
      createElement: tag => {
        created.push(tag);
        return {dataset:{}, setAttribute() {}, append() {}, addEventListener() {}};
      },
      head: {appendChild: node => appended.push(node)},
      body: {appendChild: node => appended.push(node)},
    },
  });
  return {created, appended};
}
assert.equal(run(true).created.length, 0, '日別管理では戻るボタンを生成しないこと');
assert.ok(run(false).created.includes('button'), '他画面の既定動作を変えないこと');
const html = fs.readFileSync('operation-service/daily-admin.html', 'utf8');
assert.match(html, /<body[^>]*data-no-site-back-navigation/);
assert.match(html, /href="\/toppage.html"/);
assert.match(fs.readFileSync('operation-service/daily.css', 'utf8'), /\.daily-admin-body \.site-auto-back \{ display:none!important; \}/);
console.log('operation back navigation tests: ok');
