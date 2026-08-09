const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ignored = new Set(['.git', 'node_modules', 'work']);
const sourceFiles = [];

function collect(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(fullPath);
    else if (/\.(?:html|js)$/.test(entry.name)) sourceFiles.push(fullPath);
  }
}

collect('.');

const directLoads = [];
for (const file of sourceFiles) {
  if (file.endsWith(path.join('T-time', 'private-data-client.js'))) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (/fetch\s*\([^\n]*(?:\/api\/timetables|timetables(?:-[0-9]+)?\.json)/.test(source)) {
    directLoads.push(file);
  }
}

assert.deepEqual(directLoads, [], `時刻表JSONを直接取得する画面があります: ${directLoads.join(', ')}`);

const editor = fs.readFileSync('timeedit.html', 'utf8');
assert.match(editor, /fetchTimetableBundle\(\)/);
assert.match(editor, /link\.download = selectedName/);
assert.doesNotMatch(editor, /link\.download = ['"]timetables\.json['"]/);

const expectedConsumers = [
  'JREgyoumu/ATOSsys/GD/diagram.html',
  'JREgyoumu/ATOSsys/select_timetable.html',
  'JREgyoumu/D-TAC/train_list.js',
  'JREgyoumu/D-TAC/train_staff.js',
  'JREgyoumu/D-TAC/train_timetable.js',
  'JREgyoumu/tsutatuIP/top.html',
  'JREgyoumu/tsutatuIP/view.html',
  'T-time/T-time.html',
  'T-time/alltrain.html',
  'T-time/ekibetuatos.html',
  'T-time/mobileatos.html',
  'T-time/webatos.html',
  'Testsys/select.html',
  'atosweb.html',
  'timeedit.html',
  'train_list.js',
];

for (const file of expectedConsumers) {
  assert.match(
    fs.readFileSync(file, 'utf8'),
    /TayunetPrivateData\.(?:fetchTimetables|fetchTimetableBundle)/,
    `${file} が共通の複数JSON読込を使用していません`,
  );
}

console.log(`timetable consumer audit: ok (${expectedConsumers.length} consumers)`);
