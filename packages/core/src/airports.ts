import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Feature, FeatureCollection } from 'geojson';
import type { Airport, AirportSummary, BBox, Runway } from './shared/index.js';

interface Store {
  byIdent: Map<string, Airport>;
  byIata: Map<string, Airport>;
  list: Airport[];
}

/** 机场 / 跑道查询。数据在第一次访问时同步加载，之后常驻内存。 */
export interface AirportStore {
  hasData(): boolean;
  /** 按 ICAO ident、IATA 或 GPS code 查询。 */
  get(ident: string): Airport | null;
  /** 搜索机场；精确匹配优先，其次前缀、IATA、名称、城市。 */
  search(q: string, limit?: number): Airport[];
  /** 视野内的机场摘要（大机场优先）。 */
  inBBox(bbox: BBox, limit?: number): AirportSummary[];
  /** 视野内的跑道（GeoJSON LineString）。 */
  runwaysInBBox(bbox: BBox, limit?: number): FeatureCollection;
  /** 单个机场的跑道 GeoJSON。 */
  runwaysGeoJSON(airport: Airport): FeatureCollection;
}

const AIRPORT_TYPE_RANK: Record<string, number> = {
  large_airport: 0,
  medium_airport: 1,
  small_airport: 2,
  seaplane_base: 3,
};

function runwayFeature(r: Runway): Feature {
  return {
    type: 'Feature',
    id: `${r.airportIdent}-${r.leIdent ?? 'LE'}-${r.heIdent ?? 'HE'}`,
    properties: {
      airport: r.airportIdent,
      le: r.leIdent,
      he: r.heIdent,
      lengthFt: r.lengthFt,
      widthFt: r.widthFt,
      surface: r.surface,
      closed: r.closed,
      leHeading: r.leHeading,
      heHeading: r.heHeading,
    },
    geometry: {
      type: 'LineString',
      coordinates: [
        [r.leLon, r.leLat],
        [r.heLon, r.heLat],
      ],
    },
  };
}

function emptyCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function contains(a: Airport, b: BBox): boolean {
  return a.lat >= b.lamin && a.lat <= b.lamax && a.lon >= b.lomin && a.lon <= b.lomax;
}

function searchRank(a: Airport, needle: string): number {
  const ident = a.ident.toUpperCase();
  const iata = a.iata?.toUpperCase() ?? '';
  if (ident === needle || iata === needle) return 0;
  if (ident.startsWith(needle) || iata.startsWith(needle)) return 1;
  if (iata.includes(needle)) return 2;
  if (ident.includes(needle)) return 3;
  if (a.name.toUpperCase().includes(needle)) return 4;
  if (a.municipality?.toUpperCase().includes(needle)) return 5;
  return -1;
}

export function createAirportStore(dir: string): AirportStore {
  let store: Store | null = null;

  function load(): Store {
    if (store) return store;
    const byIdent = new Map<string, Airport>();
    const byIata = new Map<string, Airport>();
    const list: Airport[] = [];
    const dataFile = join(dir, 'airports.json');

    if (existsSync(dataFile)) {
      const raw = JSON.parse(readFileSync(dataFile, 'utf8')) as Airport[];
      for (const a of raw) {
        list.push(a);
        byIdent.set(a.ident.toUpperCase(), a);
        if (a.gpsCode) byIdent.set(a.gpsCode.toUpperCase(), a);
        if (a.iata) byIata.set(a.iata.toUpperCase(), a);
      }
    } else {
      console.warn(`[airports] 未找到 ${dataFile}，跑道功能不可用。请先运行: npm run import:airports`);
    }

    store = { byIdent, byIata, list };
    return store;
  }

  return {
    hasData() {
      return load().list.length > 0;
    },

    get(ident) {
      const s = load();
      const key = ident.trim().toUpperCase();
      return s.byIdent.get(key) ?? s.byIata.get(key) ?? null;
    },

    search(q, limit = 20) {
      const s = load();
      const needle = q.trim().toUpperCase();
      if (!needle) {
        return [...s.list]
          .sort((x, y) => (AIRPORT_TYPE_RANK[x.type] ?? 9) - (AIRPORT_TYPE_RANK[y.type] ?? 9))
          .slice(0, limit);
      }
      const hits: Array<{ a: Airport; rank: number }> = [];
      for (const a of s.list) {
        const rank = searchRank(a, needle);
        if (rank >= 0) hits.push({ a, rank });
      }
      hits.sort(
        (x, y) =>
          x.rank - y.rank ||
          (AIRPORT_TYPE_RANK[x.a.type] ?? 9) - (AIRPORT_TYPE_RANK[y.a.type] ?? 9) ||
          x.a.ident.localeCompare(y.a.ident),
      );
      return hits.slice(0, limit).map((h) => h.a);
    },

    inBBox(bbox, limit = 1200) {
      const s = load();
      const out: AirportSummary[] = [];
      for (const a of s.list) {
        if (!contains(a, bbox)) continue;
        out.push({
          ident: a.ident,
          iata: a.iata,
          name: a.name,
          municipality: a.municipality,
          type: a.type,
          lat: a.lat,
          lon: a.lon,
        });
      }
      out.sort((x, y) => (AIRPORT_TYPE_RANK[x.type] ?? 9) - (AIRPORT_TYPE_RANK[y.type] ?? 9));
      return out.slice(0, limit);
    },

    runwaysInBBox(bbox, limit = 4000) {
      const s = load();
      const features: Feature[] = [];
      for (const a of s.list) {
        if (!contains(a, bbox)) continue;
        for (const r of a.runways) {
          features.push(runwayFeature(r));
          if (features.length >= limit) return { type: 'FeatureCollection', features };
        }
      }
      return { type: 'FeatureCollection', features };
    },

    runwaysGeoJSON(airport) {
      return { type: 'FeatureCollection', features: airport.runways.map(runwayFeature) };
    },
  };
}

export { emptyCollection };
export type { Airport, AirportSummary, Runway };
