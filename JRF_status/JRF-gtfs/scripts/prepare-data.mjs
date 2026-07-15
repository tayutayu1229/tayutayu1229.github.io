import { createReadStream, createWriteStream, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const zip = process.argv[2];
if (!zip) throw new Error('GTFS zip path is required');
const tmp = '/private/tmp/jrf-gtfs-build';
const out = fileURLToPath(new URL('../data/', import.meta.url));
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(join(out, 'shapes'), { recursive: true });
execFileSync('unzip', ['-o', zip, '-d', tmp], { stdio: 'ignore' });

function parseLine(line) {
  const result = []; let cell = ''; let quote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && quote && line[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quote = !quote;
    else if (c === ',' && !quote) { result.push(cell); cell = ''; }
    else cell += c;
  }
  result.push(cell.replace(/\r$/, '')); return result;
}
function csv(name) {
  const lines = readFileSync(join(tmp, name), 'utf8').trim().split(/\n/);
  const keys = parseLine(lines.shift());
  return lines.map(line => Object.fromEntries(parseLine(line).map((v, i) => [keys[i], v])));
}
function hash(id) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % 48).toString(16).padStart(2, '0'); }

const routes = Object.fromEntries(csv('routes.txt').map(r => [r.route_id, { name: r.route_long_name, color: r.route_color || '2f6feb' }]));
const stops = Object.fromEntries(csv('stops.txt').map(s => [s.stop_id, [s.stop_code, s.stop_name, +s.stop_lat, +s.stop_lon]]));
const stopTimes = {};
for (const s of csv('stop_times.txt')) (stopTimes[s.trip_id] ??= []).push([s.stop_id, s.arrival_time, s.departure_time, +s.stop_sequence]);
const trips = csv('trips.txt').map(t => [t.trip_id, t.route_id, t.trip_headsign, t.shape_id, hash(t.shape_id)]);
const calendar = csv('calendar.txt')[0];
const feed = csv('feed_info.txt')[0];
const core = { routes, stops, stopTimes, trips, meta: { start: calendar.start_date, end: calendar.end_date, version: feed.feed_version, publisher: feed.feed_publisher_name } };
createWriteStream(join(out, 'core.json')).end(JSON.stringify(core));

const buckets = new Map();
const input = createInterface({ input: createReadStream(join(tmp, 'shapes.txt')) });
let header;
for await (const line of input) {
  if (!header) { header = parseLine(line); continue; }
  const v = parseLine(line); const row = Object.fromEntries(v.map((x, i) => [header[i], x]));
  const bucket = hash(row.shape_id); const group = buckets.get(bucket) ?? new Map(); buckets.set(bucket, group);
  const points = group.get(row.shape_id) ?? []; group.set(row.shape_id, points);
  points.push([+row.shape_pt_lat, +row.shape_pt_lon, +row.shape_pt_sequence]);
}
for (const [bucket, group] of buckets) {
  const obj = Object.fromEntries([...group].map(([id, points]) => [id, points.sort((a,b) => a[2] - b[2]).map(p => [p[0], p[1]])]));
  createWriteStream(join(out, 'shapes', `${bucket}.json`)).end(JSON.stringify(obj));
}
console.log(`Prepared ${trips.length} trips, ${Object.keys(stops).length} stops and ${buckets.size} shape shards.`);
