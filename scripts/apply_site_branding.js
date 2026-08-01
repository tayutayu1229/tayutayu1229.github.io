#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ignoredDirectories = new Set(['.git', 'node_modules']);
const ignoredFiles = new Set([
  'orikubirth/HappyBirthday.html',
  'JRF_status/index.html',
  'JREgyoumu/press/public/index.html'
]);
const supportedExtensions = new Set(['.html', '.htm', '.php']);
const brandHead = [
  '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
  '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
  '<link rel="icon" href="/favicon.ico">',
  '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
  '<link rel="manifest" href="/site.webmanifest">',
  '<link rel="stylesheet" href="/assets/css/site-brand.css">',
  '<script src="/assets/js/site-brand.js" defer></script>'
].join('\n');

function collectFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(fullPath, files);
    else if (supportedExtensions.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

let updated = 0;
let skipped = 0;

for (const file of collectFiles(root)) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  if (ignoredFiles.has(relative)) {
    skipped += 1;
    continue;
  }

  let source = fs.readFileSync(file, 'utf8');
  if (source.includes('/assets/js/site-brand.js')) {
    skipped += 1;
    continue;
  }

  const headClose = source.search(/<\/head\s*>/i);
  if (headClose < 0) {
    skipped += 1;
    continue;
  }

  source = `${source.slice(0, headClose)}${brandHead}\n${source.slice(headClose)}`;
  fs.writeFileSync(file, source);
  updated += 1;
}

console.log(`Branding applied: ${updated} files; skipped: ${skipped} files.`);
