// 下载 openAIP 公开数据桶里的全球报告点（_rpp.geojson，VFR 目视报告点 VRP），精简后存盘。
// 无需 API key。用法: npm run import:rpp
// 数据授权: CC BY-NC 4.0，署名 https://www.openaip.net
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, '..', 'data');
const OUT = join(DATA_DIR, 'reporting-points.json');
const BUCKET = 'https://storage.openaip.net/openaip-system-exports/';

async function listKeys() {
  const keys = [];
  let token = '';
  for (let page = 0; page < 40; page++) {
    const url = BUCKET + '?list-type=2&max-keys=1000' + (token ? `&continuation-token=${encodeURIComponent(token)}` : '');
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`list HTTP ${res.status}`);
    const text = await res.text();
    for (const m of text.matchAll(/<Key>(.*?)<\/Key>/g)) keys.push(m[1]);
    const tok = /<NextContinuationToken>(.*?)<\/NextContinuationToken>/.exec(text);
    if (!tok) break;
    token = tok[1];
  }
  return keys;
}

/** 高度换算为英尺（openAIP: unit 0 = ft, 1 = m）。 */
function elevationFt(e) {
  if (!e || e.value == null) return null;
  const v = Number(e.value);
  if (!Number.isFinite(v)) return null;
  return e.unit === 1 ? Math.round(v * 3.28084) : Math.round(v);
}

async function fetchCountry(key) {
  const res = await fetch(BUCKET + encodeURIComponent(key), { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`${key} HTTP ${res.status}`);
  const gj = await res.json();
  const out = [];
  for (const f of gj.features ?? []) {
    const g = f.geometry;
    if (!g || g.type !== 'Point') continue;
    const p = f.properties ?? {};
    const [lon, lat] = g.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      name: p.name ?? '',
      compulsory: p.compulsory === true,
      country: p.country ?? key.slice(0, key.indexOf('_')).toUpperCase(),
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      elevationFt: elevationFt(p.elevation),
    });
  }
  return out;
}

const keys = (await listKeys()).filter((k) => k.endsWith('_rpp.geojson'));
console.log(`找到 ${keys.length} 个国家的报告点文件`);

const all = [];
const CONCURRENCY = 6;
let cursor = 0;
let done = 0;
async function worker() {
  while (cursor < keys.length) {
    const key = keys[cursor++];
    try {
      const pts = await fetchCountry(key);
      all.push(...pts);
      done++;
      if (done % 10 === 0) console.log(`  已处理 ${done}/${keys.length} …`);
    } catch (e) {
      console.warn(`  跳过 ${key}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(all));
console.log(`写入 ${OUT}: ${all.length} 个报告点`);
