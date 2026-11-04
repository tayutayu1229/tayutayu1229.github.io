// Both views must come from the same official response, never an older mirror.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
execFileSync(process.env.PYTHON || 'python3', [
  'JRF_status/scraper.py', '--output', 'JRF_status/index.html',
  '--json-output', 'JRF_status/JRF-gtfs/data/freight-status.json',
  '--health-output', 'JRF_status/JRF-gtfs/data/fetch-health.json',
], {cwd: root, stdio: 'inherit'});
