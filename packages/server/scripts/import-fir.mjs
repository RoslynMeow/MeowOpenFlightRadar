// 下载 VATSIM / VATSpy 的 FIR/UIR 边界（情报区），精简后存盘。
// 授权: CC-BY-SA-4.0，署名 VATSIM / VATSpy。用法: npm run import:fir
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, '..', 'data');
const OUT = join(DATA_DIR, 'fir.geojson');
const URL = 'https://cdn.jsdelivr.net/gh/vatsimnetwork/vatspy-data-project@master/Boundaries.geojson';

function roundCoords(coords) {
  if (typeof coords[0] === 'number') return [Math.round(coords[0] * 1e4) / 1e4, Math.round(coords[1] * 1e4) / 1e4];
  return coords.map(roundCoords);
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

console.log(`下载 ${URL} …`);
const res = await fetch(URL, { headers: { 'user-agent': 'FlightRadar/0.1' }, signal: AbortSignal.timeout(120000) });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const gj = await res.json();

const features = [];
for (const f of gj.features ?? []) {
  if (!f.geometry) continue;
  const p = f.properties ?? {};
  features.push({
    type: 'Feature',
    properties: {
      id: p.id ?? null,
      oceanic: p.oceanic === '1' || p.oceanic === 1 || p.oceanic === true,
      region: p.region ?? null,
      division: p.division ?? null,
      label_lon: num(p.label_lon),
      label_lat: num(p.label_lat),
    },
    geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
  });
}

mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`写入 ${OUT}: ${features.length} 个 FIR/UIR`);
