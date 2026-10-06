const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('webatos-system/app.js', 'utf8');
const css = fs.readFileSync('webatos-system/styles.css', 'utf8');
const html = fs.readFileSync('webatos-system/index.html', 'utf8');
const privateClient = fs.readFileSync('T-time/private-data-client.js', 'utf8');

assert.match(app, /odpt:Train\?odpt:operator=odpt\.Operator:JR-East/);
assert.match(app, /odpt:Railway\?odpt:operator=odpt\.Operator:JR-East/);
assert.match(app, /state\.stationTitles\.set/);
assert.match(app, /railwayMatchesLine/);
assert.match(app, /matchesForSearch/);
assert.match(app, /ONLINE_LINE_NAMES=\["山手","京浜東北・根岸","中央","武蔵野","常磐","常磐緩行","横須賀・総武快速","東北","高崎","東海道","東海道貨物","南武","埼京川越・山貨","中央・総武緩行","東北貨物","横浜","青梅","京葉","五日市"\]/);
assert.match(app, /--stack:/);
assert.match(css, /clip-path:polygon\(0 0,88% 0,100% 30%,100% 100%,8% 100%,0 70%\)/);
assert.match(css, /\.train-chip::before/);
assert.match(css, /animation:ticker 34s linear infinite/);
assert.match(app, /掲載中のお知らせ一覧/);
assert.match(app, /\(MPA4201\)/);
assert.match(app, /\(MPA4230\)/);
assert.match(html, /TayunetPrivateDataConfig=\{showNotices:false\}/);
assert.match(privateClient, /clientConfig\.showNotices === false/);

console.log('WebATOS online monitor checks: ok');
