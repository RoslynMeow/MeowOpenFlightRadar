import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BBox, ReportingPoint } from './shared/index.js';

/** VFR 报告点 / VRP（openAIP）查询。 */
export interface ReportingPointStore {
  hasData(): boolean;
  inBBox(bbox: BBox, limit?: number): ReportingPoint[];
}

export function createReportingPointStore(dir: string): ReportingPointStore {
  let points: ReportingPoint[] | null = null;

  function load(): ReportingPoint[] {
    if (points) return points;
    const dataFile = join(dir, 'reporting-points.json');
    if (existsSync(dataFile)) {
      points = JSON.parse(readFileSync(dataFile, 'utf8')) as ReportingPoint[];
    } else {
      console.warn(`[reporting-points] 未找到 ${dataFile}，报告点层不可用。请先运行: npm run import:rpp`);
      points = [];
    }
    return points;
  }

  return {
    hasData() {
      return load().length > 0;
    },

    inBBox(bbox, limit = 4000) {
      const list = load();
      const out: ReportingPoint[] = [];
      for (const p of list) {
        if (p.lat < bbox.lamin || p.lat > bbox.lamax || p.lon < bbox.lomin || p.lon > bbox.lomax) continue;
        out.push(p);
        if (out.length >= limit) break;
      }
      return out;
    },
  };
}
