const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const files = execFileSync('git', ['ls-files', '*.html'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const missing = [];

for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  for (const match of source.matchAll(/(?:^|\s)(?:href|src|action)\s*=\s*["']([^"']+)["']/gi)) {
    const raw = match[1].trim();
    if (!raw || /^(?:https?:|data:|mailto:|tel:|javascript:|#|\/\/|\{\{|\$\{)/i.test(raw)) continue;
    const clean = raw.split(/[?#]/, 1)[0];
    if (!clean || /[*{}]/.test(clean)) continue;
    const pathname = new URL(clean, `https://tayunet.invalid/${file}`).pathname;
    let target = path.join(root, decodeURIComponent(pathname).slice(1));
    if (clean.endsWith('/')) target = path.join(target, 'index.html');
    if (!fs.existsSync(target)) missing.push(`${file}: ${raw} -> ${path.relative(root, target)}`);
  }
}

assert.deepEqual(missing, [], `missing local page assets:\n${missing.join('\n')}`);
console.log(`site link audit: ok (${files.length} pages)`);
