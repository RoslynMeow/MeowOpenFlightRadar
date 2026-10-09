// 下载 OurAirports 数据并生成 packages/server/data/airports.json + navaids.json
// 用法: npm run import:airports
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, '..', 'data');
const OUT = join(DATA_DIR, 'airports.json');
const NAVAIDS_OUT = join(DATA_DIR, 'navaids.json');

const AIRPORTS_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const RUNWAYS_URL = 'https://davidmegginson.github.io/ourairports-data/runways.csv';
const NAVAIDS_URL = 'https://davidmegginson.github.io/ourairports-data/navaids.csv';

const KEPT_TYPES = new Set(['large_airport', 'medium_airport', 'small_airport', 'seaplane_base']);
const KEPT_NAVAID_TYPES = new Set(['VOR', 'VOR-DME', 'VORTAC', 'VOR/TACAN', 'NDB', 'NDB-DME', 'DME', 'TACAN']);

/** 极简 CSV 解析（支持引号包裹、字段内逗号/换行、"" 转义）。 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toObjects(rows) {
  const header = rows[0];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    if (!cols || cols.length < 2) continue;
    const o = {};
    for (let j = 0; j < header.length; j++) o[header[j]] = cols[j] ?? '';
    out.push(o);
  }
  return out;
}

function numOrNull(s) {
  if (s === undefined || s === null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function download(url) {
  console.log(`下载 ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

const [airportsCsv, runwaysCsv, navaidsCsv] = await Promise.all([
  download(AIRPORTS_URL),
  download(RUNWAYS_URL),
  download(NAVAIDS_URL),
]);
const airports = toObjects(parseCsv(airportsCsv));
const runways = toObjects(parseCsv(runwaysCsv));
const navaids = toObjects(parseCsv(navaidsCsv));
console.log(`airports.csv: ${airports.length} 条, runways.csv: ${runways.length} 条, navaids.csv: ${navaids.length} 条`);

const byAirport = new Map();
for (const r of runways) {
  const leLat = numOrNull(r.le_latitude_deg);
  const leLon = numOrNull(r.le_longitude_deg);
  const heLat = numOrNull(r.he_latitude_deg);
  const heLon = numOrNull(r.he_longitude_deg);
  if (leLat === null || leLon === null || heLat === null || heLon === null) continue;
  const ident = r.airport_ident;
  if (!byAirport.has(ident)) byAirport.set(ident, []);
  byAirport.get(ident).push({
    airportIdent: ident,
    leIdent: r.le_ident || null,
    heIdent: r.he_ident || null,
    leLat,
    leLon,
    heLat,
    heLon,
    leHeading: numOrNull(r.le_heading_degT),
    heHeading: numOrNull(r.he_heading_degT),
    lengthFt: numOrNull(r.length_ft),
    widthFt: numOrNull(r.width_ft),
    surface: r.surface || null,
    closed: r.closed === '1',
  });
}

const out = [];
for (const a of airports) {
  if (!KEPT_TYPES.has(a.type)) continue;
  const lat = numOrNull(a.latitude_deg);
  const lon = numOrNull(a.longitude_deg);
  if (lat === null || lon === null) continue;
  const rw = byAirport.get(a.ident);
  if (!rw || rw.length === 0) continue;
  out.push({
    ident: a.ident,
    type: a.type,
    name: a.name,
    lat,
    lon,
    elevationFt: numOrNull(a.elevation_ft),
    isoCountry: a.iso_country || '',
    municipality: a.municipality || null,
    iata: a.iata_code || null,
    gpsCode: a.gps_code || null,
    runways: rw,
  });
}

mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`写入 ${OUT}: ${out.length} 个机场`);

// ── 导航台 ──
const navaidsOut = [];
for (const n of navaids) {
  if (!KEPT_NAVAID_TYPES.has(n.type)) continue;
  const lat = numOrNull(n.latitude_deg);
  const lon = numOrNull(n.longitude_deg);
  if (lat === null || lon === null) continue;
  navaidsOut.push({
    ident: n.ident,
    name: n.name,
    type: n.type,
    freqKhz: numOrNull(n.frequency_khz),
    lat,
    lon,
    elevationFt: numOrNull(n.elevation_ft),
    isoCountry: n.iso_country || '',
    associatedAirport: n.associated_airport || null,
  });
}
writeFileSync(NAVAIDS_OUT, JSON.stringify(navaidsOut));
console.log(`写入 ${NAVAIDS_OUT}: ${navaidsOut.length} 个导航台`);
