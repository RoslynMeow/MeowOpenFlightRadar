// 生成 data/manifest.json：国家数、要素数、字节数、SHA-256。
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataRoot = join(here, '..', 'data');
const dir = join(dataRoot, 'airspace');
const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.geojson'))
  .sort();

const hash = createHash('sha256');
let count = 0;
let bytes = 0;
const mtimes = [];
for (const file of files) {
  const buf = readFileSync(join(dir, file));
  const gj = JSON.parse(buf.toString('utf8'));
  count += gj.features?.length ?? 0;
  bytes += buf.length;
  hash.update(file).update('\0').update(buf);
  mtimes.push(statSync(join(dir, file)).mtimeMs);
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date(Math.max(...mtimes)).toISOString(),
  datasets: {
    airspace: {
      file: 'airspace/index.json',
      count,
      bytes,
      sha256: hash.digest('hex'),
      source: 'openAIP',
      sourceUrl: 'https://www.openaip.net',
      license: 'CC BY-NC 4.0',
      countries: Object.keys(index).length,
      retrievedAt: new Date(Math.max(...mtimes)).toISOString(),
    },
  },
};
writeFileSync(join(dataRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[manifest] 空域: ${Object.keys(index).length} 个国家, ${count} 个要素, ${(bytes / 1048576).toFixed(2)} MB`);
