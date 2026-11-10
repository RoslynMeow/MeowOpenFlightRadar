import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { AirspaceProvider, BBox } from 'meow-open-flight-core/shared';

/** [minLat, minLon, maxLat, maxLon] */
type Box = [number, number, number, number];

export interface AirspaceStoreOptions {
  /** 空域目录（含 index.json 与各国 .geojson）；默认 `FLIGHTRADAR_AIRSPACE_DIR` 或包内 `data/airspace`。 */
  airspaceDir?: string;
}

export interface AirspaceStore extends AirspaceProvider {
  readonly dir: string;
  /** 已加载索引的国家 ISO 代码。 */
  countries(): string[];
}

export function defaultAirspaceDir(): string {
  const env = process.env.FLIGHTRADAR_AIRSPACE_DIR;
  if (env) return env;
  try {
    return join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'airspace');
  } catch {
    return join(process.cwd(), 'data', 'airspace');
  }
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

function intersects(a: Box, b: BBox): boolean {
  return !(a[2] < b.lamin || a[0] > b.lamax || a[3] < b.lomin || a[1] > b.lomax);
}

/**
 * openAIP 全球空域存储。按国家懒加载，每个要素预先计算 bbox 用于粗筛。
 * 数据授权：CC BY-NC 4.0，署名 https://www.openaip.net
 */
export function createAirspaceStore(options: AirspaceStoreOptions = {}): AirspaceStore {
  const dir = options.airspaceDir ?? defaultAirspaceDir();
  let index: Record<string, Box> | null = null;
  const cache = new Map<string, Array<{ f: Feature; b: Box }>>();

  function loadIndex(): Record<string, Box> {
    if (index) return index;
    const file = join(dir, 'index.json');
    index = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, Box>) : {};
    return index;
  }

  function loadCountry(iso: string): Array<{ f: Feature; b: Box }> {
    const cached = cache.get(iso);
    if (cached) return cached;
    const file = join(dir, `${iso}.geojson`);
    if (!existsSync(file)) {
      cache.set(iso, []);
      return [];
    }
    const gj = JSON.parse(readFileSync(file, 'utf8')) as FeatureCollection;
    const arr = (gj.features ?? []).map((f) => ({ f, b: boxOf(f.geometry) }));
    cache.set(iso, arr);
    return arr;
  }

  return {
    dir,

    hasData() {
      return Object.keys(loadIndex()).length > 0;
    },

    countries() {
      return Object.keys(loadIndex());
    },

    inBBox(bbox, limit = 2500) {
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
    },
  };
}
