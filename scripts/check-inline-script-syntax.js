#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const ignored = new Set(['.git', 'node_modules', 'vendor']);
const failures = [];
let checked = 0;

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.html?$/i.test(entry.name)) checkFile(full);
  }
}

function checkFile(file) {
  const source = fs.readFileSync(file, 'utf8');
  const scripts = source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi);
  let index = 0;
  for (const match of scripts) {
    index += 1;
    const attributes = match[1] || '';
    if (/\bsrc\s*=/.test(attributes) || /type\s*=\s*["'](?:module|application\/ld\+json)/i.test(attributes)) continue;
    try {
      new vm.Script(match[2], { filename:`${path.relative(root, file)}#script-${index}` });
      checked += 1;
    } catch (error) {
      failures.push(`${path.relative(root, file)}#script-${index}: ${error.message}`);
    }
  }
}

walk(root);
console.log(`Inline script syntax: ${checked} blocks checked`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
