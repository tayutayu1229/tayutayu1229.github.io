#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const baselinePath = path.join(root, 'security', 'xss-baseline.json');
const ignored = new Set(['.git', 'node_modules', 'vendor']);
const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(?:html?|js)$/i.test(entry.name) && full !== __filename) files.push(full);
  }
}

walk(root);

const rules = {
  innerHTML: /\.innerHTML\s*=/g,
  outerHTML: /\.outerHTML\s*=/g,
  insertAdjacentHTML: /\.insertAdjacentHTML\s*\(/g,
  documentWrite: /document\.write(?:ln)?\s*\(/g,
  inlineEventHandler: /\son[a-z]+\s*=\s*["']/gi
};
const totals = Object.fromEntries(Object.keys(rules).map(key => [key, 0]));
const forbidden = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const [name, pattern] of Object.entries(rules)) totals[name] += (source.match(pattern) || []).length;
  if (/\beval\s*\(/.test(source)) forbidden.push(`${path.relative(root, file)}: eval()`);
  if (/\bnew\s+Function\s*\(/.test(source)) forbidden.push(`${path.relative(root, file)}: new Function()`);
  if (/\b(?:href|src)\s*=\s*["']\s*javascript:/i.test(source)) forbidden.push(`${path.relative(root, file)}: javascript: URL`);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const regressions = Object.entries(totals)
  .filter(([name, count]) => count > Number(baseline[name] ?? -1))
  .map(([name, count]) => `${name}: ${count}（上限 ${baseline[name]}）`);

console.log(`XSS sink audit: ${files.length} files`, totals);
if (forbidden.length || regressions.length) {
  if (forbidden.length) console.error('禁止パターン:\n' + forbidden.join('\n'));
  if (regressions.length) console.error('危険なDOM操作が基準より増加:\n' + regressions.join('\n'));
  process.exit(1);
}
