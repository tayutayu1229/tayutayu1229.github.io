const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const requested = [];
const payloads = {
  '/api/timetable-files': {files: ['timetables.json', 'timetables-2.json', 'timetables-3.json']},
  '/api/timetables/timetables.json': {items: [{trainNumber: '1M'}]},
  '/api/timetables/timetables-2.json': {items: [{trainNumber: '2M'}]},
  '/api/timetables/timetables-3.json': {items: [{trainNumber: '3M'}]},
};
const context = {
  URL,
  encodeURIComponent,
  window: {
    location: {pathname: '/atosweb.html', search: '', hash: '', href: ''},
    TayunetFirebaseDataAuth: {async getIdToken() { return 'test-token'; }},
  },
  document: {body: null, getElementById() { return null; }},
  async fetch(url) {
    const parsed = new URL(url);
    requested.push(parsed.pathname);
    const payload = payloads[parsed.pathname];
    return new Response(JSON.stringify(payload || {error: 'not_found'}), {
      status: payload ? 200 : 404,
      headers: {'content-type': 'application/json'},
    });
  },
  Response,
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('T-time/private-data-client.js', 'utf8'), context);

context.window.TayunetPrivateData.fetchTimetableBundle().then(bundle => {
  const items = bundle.items;
  assert.deepEqual(Array.from(bundle.files, file => `${file.name}:${file.items.length}`), [
    'timetables.json:1',
    'timetables-2.json:1',
    'timetables-3.json:1',
  ]);
  assert.equal(bundle.count, 3);
  assert.deepEqual(Array.from(items, item => item.trainNumber), ['1M', '2M', '3M']);
  assert.deepEqual(requested, [
    '/api/timetable-files',
    '/api/timetables/timetables.json',
    '/api/timetables/timetables-2.json',
    '/api/timetables/timetables-3.json',
  ]);
  return context.window.TayunetPrivateData.fetchTimetables();
}).then(items => {
  assert.deepEqual(Array.from(items, item => item.trainNumber), ['1M', '2M', '3M']);
  console.log('private data multi-file bundle test: ok');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
