#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ignoredDirectories = new Set(['.git', 'node_modules', 'vendor']);
const htmlFiles = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (ignoredDirectories.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.html?$/i.test(entry.name)) htmlFiles.push(full);
  }
}

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function stripCode(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

function insideFormAt(markup, offset) {
  return markup.lastIndexOf('<form', offset) > markup.lastIndexOf('</form>', offset);
}

function linkedScriptSources(file, html) {
  const sources = [];
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const raw = match[1].split(/[?#]/)[0];
    if (!raw || /^(?:https?:)?\/\//i.test(raw)) continue;
    const resolved = raw.startsWith('/') ? path.join(root, raw) : path.resolve(path.dirname(file), raw);
    if (resolved.startsWith(root) && fs.existsSync(resolved)) sources.push(fs.readFileSync(resolved, 'utf8'));
  }
  return sources;
}

function inlineScriptSource(html) {
  return [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .join('\n');
}

function quotedInCode(code, value) {
  return code.includes(`'${value}'`) || code.includes(`"${value}"`) || code.includes(`\`${value}\``);
}

function attributesAreBound(attributes, code) {
  if (/\bon[a-z]+\s*=/i.test(attributes)) return true;
  const id = attributes.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
  if (id && (quotedInCode(code, id) || code.includes(`#${id}`))) return true;
  const dataAttributes = [...attributes.matchAll(/\bdata-([\w-]+)(?:\s*=|\s|$)/gi)].map(item => item[1]);
  if (dataAttributes.some(name => code.includes(`data-${name}`) || code.includes(`dataset.${name.replace(/-([a-z])/g, (_, char) => char.toUpperCase())}`))) return true;
  const classes = (attributes.match(/\bclass\s*=\s*["']([^"']+)["']/i)?.[1] || '').split(/\s+/).filter(Boolean);
  return classes.some(className => (code.includes(`.${className}`) || quotedInCode(code, className)) && /addEventListener|\.onclick\s*=/.test(code));
}

walk(root);

const knownGlobals = new Set([
  'alert', 'atob', 'btoa', 'clearInterval', 'clearTimeout', 'close', 'confirm',
  'decodeURIComponent', 'encodeURIComponent', 'fetch', 'open', 'parseFloat',
  'parseInt', 'print', 'prompt', 'requestAnimationFrame', 'setInterval', 'setTimeout',
]);
const findings = [];

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const relative = path.relative(root, file);
  const markup = stripCode(html);
  const ids = new Map();

  for (const match of markup.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) {
    const locations = ids.get(match[1]) || [];
    locations.push(lineAt(markup, match.index));
    ids.set(match[1], locations);
  }
  for (const [id, locations] of ids) {
    if (locations.length > 1) findings.push({kind: 'duplicate-id', file: relative, line: locations[1], detail: `${id} (${locations.length}個)`});
  }

  const inlineCode = inlineScriptSource(html);
  const code = [inlineCode, ...linkedScriptSources(file, html)].join('\n');
  const definitions = new Set();
  for (const pattern of [
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
    /\bwindow\.([A-Za-z_$][\w$]*)\s*=/g,
  ]) for (const match of code.matchAll(pattern)) definitions.add(match[1]);

  const eventAttribute = /\bon[a-z]+\s*=\s*(["'])([\s\S]*?)\1/gi;
  for (const match of markup.matchAll(eventAttribute)) {
    for (const call of match[2].matchAll(/(?<!\.)\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = call[1];
      if (!definitions.has(name) && !knownGlobals.has(name) && !['if', 'for', 'while', 'switch'].includes(name)) {
        findings.push({kind: 'undefined-inline-handler', file: relative, line: lineAt(markup, match.index), detail: name});
      }
    }
  }

  for (const match of inlineCode.matchAll(/document\.getElementById\(\s*["']([^"']+)["']\s*\)/g)) {
    const id = match[1];
    const dynamicallyCreated = new RegExp(`(?:id\\s*=\\s*[\\"']${id}[\\"']|id\\s*=\\s*\\[?[^;\\n]*${id})`).test(code);
    if (!ids.has(id) && !dynamicallyCreated) findings.push({kind: 'missing-static-id', file: relative, line: lineAt(inlineCode, match.index), detail: id});
  }

  for (const match of markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const attributes = match[1];
    const label = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50) || '(ラベルなし)';
    if (/\bdisabled(?:\s|=|$)/i.test(attributes)) continue;
    const id = attributes.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
    const dataAttributes = [...attributes.matchAll(/\bdata-([\w-]+)(?:\s*=|\s|$)/gi)].map(item => item[1]);
    if (/\bon[a-z]+\s*=/i.test(attributes)) continue;
    if (id) {
      const referenced = [
        `getElementById('${id}')`, `getElementById("${id}")`, `#${id}`,
        `$('${id}')`, `$("${id}")`,
      ].some(token => code.includes(token)) || quotedInCode(code, id);
      if (!referenced && !insideFormAt(markup, match.index)) findings.push({kind: 'unreferenced-button-id', file: relative, line: lineAt(markup, match.index), detail: `${id}: ${label}`});
      continue;
    }
    if (dataAttributes.length) {
      const referenced = dataAttributes.some(name => code.includes(`data-${name}`) || code.includes(`dataset.${name.replace(/-([a-z])/g, (_, char) => char.toUpperCase())}`));
      if (!referenced) findings.push({kind: 'unreferenced-button-data', file: relative, line: lineAt(markup, match.index), detail: `${dataAttributes.join(',')}: ${label}`});
      continue;
    }
    if (/\b(?:name|form)\s*=/i.test(attributes)) continue;
    if (/\btype\s*=\s*["'](?:submit|reset)["']/i.test(attributes)) continue;
    if (!/\btype\s*=/i.test(attributes) && insideFormAt(markup, match.index)) continue;
    const classes = (attributes.match(/\bclass\s*=\s*["']([^"']+)["']/i)?.[1] || '').split(/\s+/).filter(Boolean);
    const classIsBound = classes.some(className => (code.includes(`.${className}`) || quotedInCode(code, className)) && /addEventListener|\.onclick\s*=/.test(code));
    if (!classIsBound) findings.push({kind: 'possibly-inert-button', file: relative, line: lineAt(markup, match.index), detail: label});
  }

  for (const match of markup.matchAll(/<a\b([^>]*)\bhref\s*=\s*["']#["']([^>]*)>/gi)) {
    const attributes = `${match[1]} ${match[2]}`;
    if (!attributesAreBound(attributes, code)) {
      findings.push({kind: 'inert-placeholder-link', file: relative, line: lineAt(markup, match.index), detail: 'href="#"'});
    }
  }
}

const groups = Object.groupBy
  ? Object.groupBy(findings, finding => finding.kind)
  : findings.reduce((out, finding) => ((out[finding.kind] ||= []).push(finding), out), {});

console.log(`UI action audit: ${htmlFiles.length} pages`);
for (const [kind, items] of Object.entries(groups)) {
  console.log(`\n${kind}: ${items.length}`);
  for (const item of items.slice(0, 200)) console.log(`  ${item.file}:${item.line} ${item.detail}`);
  if (items.length > 200) console.log(`  ... ${items.length - 200} more`);
}
if (!findings.length) console.log('No findings.');
if (findings.length) process.exitCode = 1;
