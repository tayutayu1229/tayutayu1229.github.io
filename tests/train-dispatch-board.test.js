const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const board = fs.readFileSync(path.join(root, 'train_dispatch-board.html'), 'utf8');
const top = fs.readFileSync(path.join(root, 'toppage.html'), 'utf8');

assert.match(top, /data-name="運転整理在線ボード"[^>]+train_dispatch-board\.html/);
assert.match(board, /運転整理在線ボード/);
assert.match(board, /function analyze\(list\)/, 'train spacing analysis is required');
assert.match(board, /前方[　 ]/, 'selected trains must show their leading train');
assert.match(board, /後方[　 ]/, 'selected trains must show their following train');
assert.match(board, /接近組/);
assert.match(board, /間隔大/);
assert.match(board, /@media\(max-width:600px\)/, 'the board must support phones');
assert.doesNotMatch(board, /\.innerHTML\s*=/, 'new board must avoid dynamic HTML sinks');

console.log('train dispatch board tests: ok');
