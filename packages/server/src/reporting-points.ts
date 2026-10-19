import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BBox, ReportingPoint } from '@flightradar/shared';
import { dataDir } from './paths.js';

let points: ReportingPoint[] | null = null;

function load(): ReportingPoint[] {
  if (points) return points;
  const dataFile = join(dataDir(), 'reporting-points.json');
  if (existsSync(dataFile)) {
    points = JSON.parse(readFileSync(dataFile, 'utf8')) as ReportingPoint[];
  } else {
    console.warn(`[reporting-points] 未找到 ${dataFile}，报告点层不可用。请先运行: npm run import:rpp`);
    points = [];
  }
  return points;
}

export function hasReportingPointData(): boolean {
  return load().length > 0;
}

/** 视野内的报告点（VFR VRP，受 limit 限制）。 */
export function reportingPointsInBBox(bbox: BBox, limit = 4000): ReportingPoint[] {
  const list = load();
  const out: ReportingPoint[] = [];
  for (const p of list) {
    if (p.lat < bbox.lamin || p.lat > bbox.lamax || p.lon < bbox.lomin || p.lon > bbox.lomax) continue;
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}
