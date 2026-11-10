import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BBox, Navaid } from './shared/index.js';

/** 导航台（VOR / NDB / DME / TACAN）查询。 */
export interface NavaidStore {
  hasData(): boolean;
  inBBox(bbox: BBox, limit?: number): Navaid[];
}

export function createNavaidStore(dir: string): NavaidStore {
  let navaids: Navaid[] | null = null;

  function load(): Navaid[] {
    if (navaids) return navaids;
    const dataFile = join(dir, 'navaids.json');
    if (existsSync(dataFile)) {
      navaids = JSON.parse(readFileSync(dataFile, 'utf8')) as Navaid[];
    } else {
      console.warn(`[navaids] 未找到 ${dataFile}，导航台层不可用。请先运行: npm run import:airports`);
      navaids = [];
    }
    return navaids;
  }

  return {
    hasData() {
      return load().length > 0;
    },

    inBBox(bbox, limit = 2000) {
      const list = load();
      const out: Navaid[] = [];
      for (const n of list) {
        if (n.lat < bbox.lamin || n.lat > bbox.lamax || n.lon < bbox.lomin || n.lon > bbox.lomax) continue;
        out.push(n);
        if (out.length >= limit) break;
      }
      return out;
    },
  };
}
