import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Feature, FeatureCollection } from 'geojson';
import type { BBox, IfrFix } from '@flightradar/shared';
import { dataDir } from './paths.js';

interface RawFix {
  i: string;
  la: number;
  lo: number;
  k: string;
}
interface RawProc {
  a: string;
  t: 'SID' | 'STAR';
  n: string;
  tr: string;
  p: number[][];
  f: string[];
}

let fixes: RawFix[] | null = null;
let procs: RawProc[] | null = null;

function loadFixes(): RawFix[] {
  if (fixes) return fixes;
  const file = join(dataDir(), 'cifp-fixes.json');
  if (existsSync(file)) fixes = JSON.parse(readFileSync(file, 'utf8')) as RawFix[];
  else {
    console.warn(`[cifp] 未找到 ${file}，IFR 航路点层不可用。请运行: npm run import:cifp`);
    fixes = [];
  }
  return fixes;
}

function loadProcs(): RawProc[] {
  if (procs) return procs;
  const file = join(dataDir(), 'cifp-procedures.json');
  if (existsSync(file)) procs = JSON.parse(readFileSync(file, 'utf8')) as RawProc[];
  else {
    console.warn(`[cifp] 未找到 ${file}，SID/STAR 不可用。请运行: npm run import:cifp`);
    procs = [];
  }
  return procs;
}

export function hasCifpData(): boolean {
  return loadFixes().length > 0;
}

/** 视野内的 IFR 航路点（FAA CIFP，受 limit 限制）。 */
export function fixesInBBox(bbox: BBox, limit = 5000): IfrFix[] {
  const list = loadFixes();
  const out: IfrFix[] = [];
  for (const f of list) {
    if (f.la < bbox.lamin || f.la > bbox.lamax || f.lo < bbox.lomin || f.lo > bbox.lomax) continue;
    out.push({ ident: f.i, lat: f.la, lon: f.lo, kind: f.k === 'E' ? 'enroute' : 'terminal' });
    if (out.length >= limit) break;
  }
  return out;
}

/** 某机场的 SID/STAR 进离场程序（每条 过渡 一段折线）。 */
export function proceduresForAirport(ident: string): FeatureCollection {
  const key = ident.trim().toUpperCase();
  const features: Feature[] = [];
  for (const p of loadProcs()) {
    if (p.a !== key || p.p.length < 2) continue;
    features.push({
      type: 'Feature',
      properties: { type: p.t, name: p.n, transition: p.tr, fixes: p.f },
      geometry: { type: 'LineString', coordinates: p.p.map(([lat, lon]) => [lon, lat]) },
    });
  }
  return { type: 'FeatureCollection', features };
}
