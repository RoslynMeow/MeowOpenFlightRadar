import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { BBox } from '@flightradar/shared';
import { dataDir } from './paths.js';

type Box = [number, number, number, number];

let store: { features: Feature[]; boxes: Box[] } | null = null;

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

function load(): { features: Feature[]; boxes: Box[] } {
  if (store) return store;
  const file = join(dataDir(), 'fir.geojson');
  if (existsSync(file)) {
    const gj = JSON.parse(readFileSync(file, 'utf8')) as FeatureCollection;
    const features = gj.features ?? [];
    store = { features, boxes: features.map((f) => boxOf(f.geometry)) };
  } else {
    console.warn(`[fir] 未找到 ${file}，情报区层不可用。请运行: npm run import:fir`);
    store = { features: [], boxes: [] };
  }
  return store;
}

export function hasFirData(): boolean {
  return load().features.length > 0;
}

function intersects(a: Box, b: BBox): boolean {
  return !(a[2] < b.lamin || a[0] > b.lamax || a[3] < b.lomin || a[1] > b.lomax);
}

/** 视野内的 FIR/UIR 边界（VATSIM/VATSpy，CC-BY-SA-4.0）。 */
export function firInBBox(bbox: BBox, limit = 1500): FeatureCollection {
  const s = load();
  const features: Feature[] = [];
  for (let i = 0; i < s.features.length; i++) {
    if (!intersects(s.boxes[i], bbox)) continue;
    features.push(s.features[i]);
    if (features.length >= limit) break;
  }
  return { type: 'FeatureCollection', features };
}
