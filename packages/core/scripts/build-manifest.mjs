// 生成 data/manifest.json：条数、字节数、SHA-256、来源与许可证。
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'data');

const datasets = [
  {
    key: 'airports',
    file: 'airports.json',
    source: 'OurAirports',
    sourceUrl: 'https://ourairports.com/data/',
    license: 'Public Domain',
  },
  {
    key: 'navaids',
    file: 'navaids.json',
    source: 'OurAirports',
    sourceUrl: 'https://ourairports.com/data/',
    license: 'Public Domain',
  },
  {
    key: 'reportingPoints',
    file: 'reporting-points.json',
    source: 'openAIP',
    sourceUrl: 'https://www.openaip.net',
    license: 'CC BY-NC 4.0',
  },
  {
    key: 'fir',
    file: 'fir.geojson',
    source: 'VATSIM / VATSpy',
    sourceUrl: 'https://github.com/vatsimnetwork/vatspy-data-project',
    license: 'CC-BY-SA-4.0',
  },
];

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

const out = {};
const mtimes = [];
for (const d of datasets) {
  const path = join(dir, d.file);
  const stat = statSync(path);
  const buf = readFileSync(path);
  const json = JSON.parse(buf.toString('utf8'));
  const count = Array.isArray(json) ? json.length : Array.isArray(json.features) ? json.features.length : 0;
  out[d.key] = {
    file: d.file,
    count,
    bytes: buf.length,
    sha256: sha256(buf),
    source: d.source,
    sourceUrl: d.sourceUrl,
    license: d.license,
    retrievedAt: stat.mtime.toISOString(),
  };
  mtimes.push(stat.mtimeMs);
  console.log(`[manifest] ${d.file}: ${count} 条, ${buf.length} 字节`);
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date(Math.max(...mtimes)).toISOString(),
  datasets: out,
};
writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[manifest] 写入 ${join(dir, 'manifest.json')}`);
