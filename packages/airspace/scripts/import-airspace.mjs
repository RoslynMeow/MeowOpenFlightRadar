// 下载 openAIP 公开数据桶里的全球空域（_asp.geojson），精简后按国家存盘。
// 无需 API key。用法: npm run import:airspace
// 数据授权: CC BY-NC 4.0，署名 https://www.openaip.net
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, '..', 'data', 'airspace');
const BUCKET = 'https://storage.openaip.net/openaip-system-exports/';

async function listKeys() {
  const keys = [];
  let token = '';
  for (let page = 0; page < 30; page++) {
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

function roundCoords(coords) {
  if (typeof coords[0] === 'number') return [Math.round(coords[0] * 1e4) / 1e4, Math.round(coords[1] * 1e4) / 1e4];
  return coords.map(roundCoords);
}

function bboxOfGeometry(geometry) {
  let minLat = 90;
  let minLon = 180;
  let maxLat = -90;
  let maxLon = -180;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      const [lon, lat] = c;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    } else {
      c.forEach(walk);
    }
  };
  walk(geometry.coordinates);
  return [minLat, minLon, maxLat, maxLon];
}

function trimProps(p) {
  const lim = (l) => (l ? { v: l.value ?? null, unit: l.unit ?? null } : null);
  return {
    name: p.name ?? null,
    type: p.type ?? null,
    icaoClass: p.icaoClass ?? null,
    lower: lim(p.lowerLimit),
    upper: lim(p.upperLimit),
    country: p.country ?? null,
  };
}

async function fetchCountry(key) {
  const res = await fetch(BUCKET + key, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`${key} HTTP ${res.status}`);
  const gj = await res.json();
  const features = [];
  for (const f of gj.features ?? []) {
    if (!f.geometry) continue;
    features.push({
      type: 'Feature',
      properties: trimProps(f.properties ?? {}),
      geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
    });
  }
  return features;
}

const keys = (await listKeys()).filter((k) => k.endsWith('_asp.geojson'));
console.log(`找到 ${keys.length} 个国家的空域文件`);
mkdirSync(OUT_DIR, { recursive: true });

const index = {};
let done = 0;
const CONCURRENCY = 5;
let cursor = 0;

async function worker() {
  while (cursor < keys.length) {
    const key = keys[cursor++];
    const iso = key.slice(0, key.indexOf('_')).toUpperCase();
    try {
      const features = await fetchCountry(key);
      if (features.length === 0) continue;
      let minLat = 90;
      let minLon = 180;
      let maxLat = -90;
      let maxLon = -180;
      for (const f of features) {
        const b = bboxOfGeometry(f.geometry);
        if (b[0] < minLat) minLat = b[0];
        if (b[1] < minLon) minLon = b[1];
        if (b[2] > maxLat) maxLat = b[2];
        if (b[3] > maxLon) maxLon = b[3];
      }
      writeFileSync(join(OUT_DIR, `${iso}.geojson`), JSON.stringify({ type: 'FeatureCollection', features }));
      index[iso] = [minLat, minLon, maxLat, maxLon];
      done++;
      if (done % 10 === 0) console.log(`  已处理 ${done}/${keys.length} …`);
    } catch (e) {
      console.warn(`  跳过 ${key}: ${e.message}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index));
console.log(`完成：${done} 个国家，写入 ${OUT_DIR}`);
