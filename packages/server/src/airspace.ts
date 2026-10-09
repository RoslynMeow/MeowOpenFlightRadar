import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { BBox } from '@flightradar/shared';
import { dataDir } from './paths.js';

function airspaceDir(): string {
  return join(dataDir(), 'airspace');
}

/** [minLat, minLon, maxLat, maxLon] */
type Box = [number, number, number, number];

let index: Record<string, Box> | null = null;
const cache = new Map<string, Array<{ f: Feature; b: Box }>>();

function loadIndex(): Record<string, Box> {
  if (index) return index;
  const file = join(airspaceDir(), 'index.json');
  index = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, Box>) : {};
  return index;
}

export function hasAirspaceData(): boolean {
  return Object.keys(loadIndex()).length > 0;
}

function boxOf(geometry: Geometry): Box {
  let minLat = 90;
  let minLon = 180;
  let maxLat = -90;
  let maxLon = -180;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const lon = c[0] as number;
      const lat = c[1] as number;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    } else if (Array.isArray(c)) {
      c.forEach(walk);
    }
  };
  walk((geometry as { coordinates: unknown }).coordinates);
  return [minLat, minLon, maxLat, maxLon];
}

function loadCountry(iso: string): Array<{ f: Feature; b: Box }> {
  const cached = cache.get(iso);
  if (cached) return cached;
  const file = join(airspaceDir(), `${iso}.geojson`);
  if (!existsSync(file)) {
    cache.set(iso, []);
    return [];
  }
  const gj = JSON.parse(readFileSync(file, 'utf8')) as FeatureCollection;
  const arr = (gj.features ?? []).map((f) => ({ f, b: boxOf(f.geometry) }));
  cache.set(iso, arr);
  return arr;
}

function intersects(a: Box, b: BBox): boolean {
  return !(a[2] < b.lamin || a[0] > b.lamax || a[3] < b.lomin || a[1] > b.lomax);
}

/** 视野内的空域（按国家懒加载 + 每要素 bbox 过滤，受 limit 限制）。 */
export function airspaceInBBox(bbox: BBox, limit = 2500): FeatureCollection {
  const idx = loadIndex();
  const features: Feature[] = [];
  for (const [iso, cb] of Object.entries(idx)) {
    if (!intersects(cb, bbox)) continue;
    for (const { f, b } of loadCountry(iso)) {
      if (!intersects(b, bbox)) continue;
      features.push(f);
      if (features.length >= limit) return { type: 'FeatureCollection', features };
    }
  }
  return { type: 'FeatureCollection', features };
}
