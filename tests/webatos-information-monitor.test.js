const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('webatos-system/app.js', 'utf8');
const css = fs.readFileSync('webatos-system/styles.css', 'utf8');

assert.match(app, /odpt:TrainInformation\?odpt:operator=odpt\.Operator:jre-is/);
assert.doesNotMatch(app, /acl:consumerKey/);
assert.match(app, /state\.infoActive=mapped\.some/);
assert.match(app, /has-information/);
assert.match(css, /\.nav-btn\.has-information::before/);
assert.doesNotMatch(css, /nth-child\(9\).*::before/);
assert.match(app, /data-info-tab="accident"/);
assert.match(app, /data-info-tab="general"/);
assert.match(app, /data-info-page/);
assert.match(app, /information-refresh/);

console.log('WebATOS information monitor checks: ok');
