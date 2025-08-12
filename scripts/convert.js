const fs = require('fs');
const path = require('path');
const marked = require('marked');

const file = process.argv[2];
const content = fs.readFileSync(file, 'utf8');
const metadata = {};
const lines = content.split('\n');

lines.forEach(line => {
  if (line.startsWith('title:')) metadata.title = line.replace('title:', '').trim();
  if (line.startsWith('date:')) metadata.date = line.replace('date:', '').trim();
  if (line.startsWith('tags:')) metadata.tags = line.replace('tags:', '').split(',').map(t => t.trim());
});

metadata.content = marked.parse(content);
metadata.filename = path.basename(file);

console.log(JSON.stringify(metadata, null, 2));
