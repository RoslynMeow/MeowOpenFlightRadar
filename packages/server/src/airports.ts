import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Feature, FeatureCollection } from 'geojson';
import type { Airport, AirportSummary, BBox, Runway } from '@flightradar/shared';
import { dataDir } from './paths.js';

interface Store {
  byIdent: Map<string, Airport>;
  byIata: Map<string, Airport>;
  list: Airport[];
}

let store: Store | null = null;

function load(): Store {
  if (store) return store;
  const byIdent = new Map<string, Airport>();
  const byIata = new Map<string, Airport>();
  const list: Airport[] = [];
  const dataFile = join(dataDir(), 'airports.json');

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

export function hasAirportData(): boolean {
  return load().list.length > 0;
}

export function getAirport(ident: string): Airport | null {
  const s = load();
  const key = ident.trim().toUpperCase();
  return s.byIdent.get(key) ?? s.byIata.get(key) ?? null;
}

export function searchAirports(q: string, limit = 20): Airport[] {
  const s = load();
  const needle = q.trim().toUpperCase();
  if (!needle) return s.list.slice(0, limit);
  const hits: Airport[] = [];
  for (const a of s.list) {
    if (
      a.ident.toUpperCase().includes(needle) ||
      (a.iata && a.iata.toUpperCase().includes(needle)) ||
      a.name.toUpperCase().includes(needle) ||
      (a.municipality && a.municipality.toUpperCase().includes(needle))
    ) {
      hits.push(a);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

/** 把机场跑道转成 GeoJSON FeatureCollection（坐标 WGS-84）。 */
export function runwaysGeoJSON(airport: Airport): FeatureCollection {
  const features: Feature[] = airport.runways.map((r) => ({
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
  }));
  return { type: 'FeatureCollection', features };
}

const AIRPORT_TYPE_RANK: Record<string, number> = {
  large_airport: 0,
  medium_airport: 1,
  small_airport: 2,
  seaplane_base: 3,
};

/** 视野内的机场摘要（大机场优先，受 limit 限制）。 */
export function airportsInBBox(bbox: BBox, limit = 1200): AirportSummary[] {
  const s = load();
  const out: AirportSummary[] = [];
  for (const a of s.list) {
    if (a.lat < bbox.lamin || a.lat > bbox.lamax || a.lon < bbox.lomin || a.lon > bbox.lomax) continue;
    out.push({ ident: a.ident, iata: a.iata, name: a.name, type: a.type, lat: a.lat, lon: a.lon });
  }
  out.sort((x, y) => (AIRPORT_TYPE_RANK[x.type] ?? 9) - (AIRPORT_TYPE_RANK[y.type] ?? 9));
  return out.slice(0, limit);
}

/** 视野内的跑道（GeoJSON LineString，坐标 WGS-84）。 */
export function runwaysInBBox(bbox: BBox, limit = 4000): FeatureCollection {
  const s = load();
  const features: Feature[] = [];
  for (const a of s.list) {
    if (a.lat < bbox.lamin || a.lat > bbox.lamax || a.lon < bbox.lomin || a.lon > bbox.lomax) continue;
    for (const r of a.runways) {
      features.push({
        type: 'Feature',
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
      });
      if (features.length >= limit) return { type: 'FeatureCollection', features };
    }
  }
  return { type: 'FeatureCollection', features };
}

export type { Airport, AirportSummary, Runway };
