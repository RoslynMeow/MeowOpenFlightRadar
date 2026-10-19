// 下载 FAA CIFP（ARINC 424）并生成航路点与 SID/STAR 进离场程序数据。
// 用法: npm run import:cifp
// 数据授权: 美国联邦政府作品，公有领域（FAA）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzip } from './lib/unzip.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, '..', 'data');
const FIXES_OUT = join(DATA_DIR, 'cifp-fixes.json');
const PROC_OUT = join(DATA_DIR, 'cifp-procedures.json');
const META_OUT = join(DATA_DIR, 'cifp-meta.json');

const PAGE = 'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/download/';

/** 从 FAA 页面解析出当前生效的 CIFP zip URL。 */
async function resolveUrl() {
  const res = await fetch(PAGE, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`CIFP 页面 HTTP ${res.status}`);
  const html = await res.text();
  const codes = new Set();
  for (const m of html.matchAll(/cifp\/(CIFP_(\d{6}))\.zip/gi)) codes.add(m[2]);
  if (codes.size === 0) throw new Error('未在 CIFP 页面找到下载链接');
  const today = new Date();
  const dated = [...codes].map((c) => {
    const yy = Number(c.slice(0, 2));
    const mm = Number(c.slice(2, 4));
    const dd = Number(c.slice(4, 6));
    return { code: c, date: new Date(2000 + yy, mm - 1, dd) };
  });
  const past = dated.filter((d) => d.date <= today).sort((a, b) => b.code.localeCompare(a.code));
  const chosen = (past[0] ?? dated.sort((a, b) => a.code.localeCompare(b.code))[0]).code;
  return `https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_${chosen}.zip`;
}

// ── ARINC 424 字段解码 ──
function parseLat(s) {
  if (!/^[NS]\d{8}$/.test(s)) return null;
  const v = Number(s.slice(1, 3)) + Number(s.slice(3, 5)) / 60 + Number(s.slice(5, 9)) / 100 / 3600;
  return s[0] === 'S' ? -v : v;
}
function parseLon(s) {
  if (!/^[EW]\d{9}$/.test(s)) return null;
  const v = Number(s.slice(1, 4)) + Number(s.slice(4, 6)) / 60 + Number(s.slice(6, 10)) / 100 / 3600;
  return s[0] === 'W' ? -v : v;
}
const r5 = (n) => Math.round(n * 1e5) / 1e5;

console.log(`解析 CIFP 下载地址 …`);
const url = await resolveUrl();
console.log(`下载 ${url} …`);
const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
if (!res.ok) throw new Error(`CIFP zip HTTP ${res.status}`);
const zipBuf = Buffer.from(await res.arrayBuffer());
const files = unzip(zipBuf);
const entry = files.get('FAACIFP18');
if (!entry) throw new Error('zip 内未找到 FAACIFP18');
const lines = entry.toString('latin1').split(/\r?\n/);
console.log(`FAACIFP18: ${lines.length} 行`);

// ── 1) 航路点（Section E/A 航路点、Section P/C 终端航路点） ──
/** ident -> { ident, lat, lon, kind } */
const fixes = new Map();
for (const l of lines) {
  if (l.length < 51 || l[0] !== 'S') continue;
  if (l[4] === 'E' && l[5] === 'A') {
    const ident = l.slice(13, 18).trim();
    const lat = parseLat(l.slice(32, 41));
    const lon = parseLon(l.slice(41, 51));
    if (ident && lat !== null && lon !== null && !fixes.has(ident)) {
      fixes.set(ident, { i: ident, la: r5(lat), lo: r5(lon), k: 'E' });
    }
  } else if (l[4] === 'P' && l[12] === 'C') {
    const ident = l.slice(13, 18).trim();
    const lat = parseLat(l.slice(32, 41));
    const lon = parseLon(l.slice(41, 51));
    if (ident && lat !== null && lon !== null && !fixes.has(ident)) {
      fixes.set(ident, { i: ident, la: r5(lat), lo: r5(lon), k: 'T' });
    }
  }
}
console.log(`航路点: ${fixes.size}`);

// ── 2) 坐标索引（用于解析程序航段） ──
const coordOf = new Map();
const addCoord = (ident, lat, lon) => {
  if (ident && lat !== null && lon !== null && !coordOf.has(ident)) coordOf.set(ident, [lat, lon]);
};
if (existsSync(join(DATA_DIR, 'airports.json'))) {
  for (const a of JSON.parse(readFileSync(join(DATA_DIR, 'airports.json'), 'utf8'))) addCoord(a.ident, a.lat, a.lon);
}
if (existsSync(join(DATA_DIR, 'navaids.json'))) {
  for (const n of JSON.parse(readFileSync(join(DATA_DIR, 'navaids.json'), 'utf8'))) addCoord(n.ident, n.lat, n.lon);
}
for (const f of fixes.values()) coordOf.set(f.i, [f.la, f.lo]); // CIFP 航路点优先

// ── 3) SID/STAR 程序（Section P 子段 D=SID / E=STAR） ──
// 按 airport|type|ident|transition 分组，seq 排序后用坐标索引还原折线。
const groups = new Map();
for (const l of lines) {
  if (l.length < 49 || l[0] !== 'S' || l[4] !== 'P') continue;
  const sub = l[12];
  if (sub !== 'D' && sub !== 'E') continue;
  if (l[38] !== '0') continue; // 仅主记录（跳过续行）
  const airport = l.slice(6, 10).trim();
  const procIdent = l.slice(13, 19).trim();
  const transition = l.slice(20, 25).trim();
  const seq = Number(l.slice(26, 29));
  const fixIdent = l.slice(29, 34).trim();
  if (!airport || !procIdent || !fixIdent || !Number.isFinite(seq)) continue;
  const key = `${airport}|${sub}|${procIdent}|${transition}`;
  let g = groups.get(key);
  if (!g) {
    g = { a: airport, t: sub === 'D' ? 'SID' : 'STAR', n: procIdent, tr: transition, legs: [] };
    groups.set(key, g);
  }
  g.legs.push({ seq, fix: fixIdent });
}

const procedures = [];
for (const g of groups.values()) {
  g.legs.sort((a, b) => a.seq - b.seq);
  const p = [];
  const f = [];
  for (const leg of g.legs) {
    const c = coordOf.get(leg.fix);
    if (!c) continue;
    p.push([r5(c[0]), r5(c[1])]);
    f.push(leg.fix);
  }
  if (p.length < 2) continue;
  procedures.push({ a: g.a, t: g.t, n: g.n, tr: g.tr, p, f });
}
console.log(`SID/STAR 程序段: ${procedures.length}`);

mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(FIXES_OUT, JSON.stringify([...fixes.values()]));
writeFileSync(PROC_OUT, JSON.stringify(procedures));
writeFileSync(META_OUT, JSON.stringify({ url, fixes: fixes.size, procedures: procedures.length }));
console.log(`写入 ${FIXES_OUT}: ${fixes.size} 个航路点`);
console.log(`写入 ${PROC_OUT}: ${procedures.length} 条程序（含过渡）`);
