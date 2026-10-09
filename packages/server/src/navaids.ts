import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BBox, Navaid } from '@flightradar/shared';
import { dataDir } from './paths.js';

let navaids: Navaid[] | null = null;

function load(): Navaid[] {
  if (navaids) return navaids;
  const dataFile = join(dataDir(), 'navaids.json');
  if (existsSync(dataFile)) {
    navaids = JSON.parse(readFileSync(dataFile, 'utf8')) as Navaid[];
  } else {
    console.warn(`[navaids] 未找到 ${dataFile}，导航台层不可用。请先运行: npm run import:airports`);
    navaids = [];
  }
  return navaids;
}

export function hasNavaidData(): boolean {
  return load().length > 0;
}

/** 视野内的导航台（受 limit 限制）。 */
export function navaidsInBBox(bbox: BBox, limit = 2000): Navaid[] {
  const list = load();
  const out: Navaid[] = [];
  for (const n of list) {
    if (n.lat < bbox.lamin || n.lat > bbox.lamax || n.lon < bbox.lomin || n.lon > bbox.lomax) continue;
    out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}
