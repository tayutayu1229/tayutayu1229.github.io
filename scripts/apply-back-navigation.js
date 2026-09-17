#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const loader = '<script src="/assets/js/back-navigation.js" defer></script>';
const ignoredDirectories = new Set(['.git', 'node_modules']);

function htmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return [];
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(absolute);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.html') ? [absolute] : [];
  });
}

let updated = 0;
for (const file of htmlFiles(root)) {
  const source = fs.readFileSync(file, 'utf8');
  if (!/<(?:html|body)\b/i.test(source)) continue;
  if (source.includes('/assets/js/back-navigation.js')) continue;
  if (!/<\/head\s*>/i.test(source)) throw new Error(`</head> がありません: ${path.relative(root, file)}`);
  const output = source.replace(/<\/head\s*>/i, `${loader}\n</head>`);
  fs.writeFileSync(file, output);
  updated += 1;
}

console.log(`back-navigation loader: ${updated} files updated`);
