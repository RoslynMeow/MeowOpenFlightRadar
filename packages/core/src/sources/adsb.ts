import { bboxCenter, bboxRadiusNm, inBBox, type Aircraft, type BBox } from '../shared/index.js';
import { kindForTypeCode } from './kind.js';
import type { AircraftSource } from './types.js';
import { UpstreamError } from './types.js';

const BASE = 'https://api.adsb.lol/v2';
/** adsb.lol 半径查询的上限（海里）。 */
const MAX_RADIUS_NM = 250;
const REQUEST_TIMEOUT_MS = 15000;
const UA = 'Mozilla/5.0 (compatible; MeowOpenFlightRadar/1.0)';

interface AdsbRow {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  alt_geom?: number;
  gs?: number;
  track?: number;
  baro_rate?: number;
  geom_rate?: number;
  t?: string;
  r?: string;
  squawk?: string;
  category?: string;
  seen_pos?: number;
  ownOp?: string;
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Normalize one adsb.lol aircraft row. Exported for tests. */
export function normalizeAdsbRow(row: AdsbRow, bbox: BBox): Aircraft | null {
  const hex = asString(row.hex)?.toLowerCase();
  const lat = asNumber(row.lat);
  const lon = asNumber(row.lon);
  if (!hex || lat === null || lon === null || !inBBox(lat, lon, bbox)) return null;

  const rawAlt = row.alt_baro;
  const altFt = rawAlt === 'ground' ? 0 : asNumber(rawAlt);
  const typeCode = asString(row.t);

  return {
    icao24: hex,
    callsign: asString(row.flight),
    lat,
    lon,
    altFt,
    altGeomFt: asNumber(row.alt_geom),
    groundSpeedKt: asNumber(row.gs),
    trackDeg: asNumber(row.track),
    verticalRateFpm: asNumber(row.baro_rate) ?? asNumber(row.geom_rate),
    onGround: rawAlt === 'ground' || altFt === 0,
    originCountry: null,
    category: asString(row.category),
    registration: asString(row.r),
    typeCode,
    model: null,
    kind: kindForTypeCode(typeCode),
    operator: asString(row.ownOp),
    origin: null,
    destination: null,
    squawk: asString(row.squawk),
    seenPos: asNumber(row.seen_pos),
    source: 'adsb',
    predictable: true,
  };
}

/**
 * Open ADS-B source (adsb.lol). No key needed; coverage depends on community
 * receivers. Used as a selectable provider and as the automatic fallback.
 */
export class AdsbSource implements AircraftSource {
  readonly id = 'adsb';

  async fetchAircraft(bbox: BBox): Promise<Aircraft[]> {
    const center = bboxCenter(bbox);
    const dist = Math.min(MAX_RADIUS_NM, Math.max(5, Math.ceil(bboxRadiusNm(bbox))));
    const url = `${BASE}/lat/${center.lat.toFixed(3)}/lon/${center.lng.toFixed(3)}/dist/${dist}`;
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 429) throw new UpstreamError(429, 'adsb.lol rate limited (429)');
    if (!res.ok) throw new UpstreamError(res.status || 502, `adsb.lol HTTP ${res.status}`);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new UpstreamError(502, 'adsb.lol: bad JSON');
    }
    const rows =
      body && typeof body === 'object' && Array.isArray((body as { ac?: unknown }).ac)
        ? (body as { ac: AdsbRow[] }).ac
        : [];

    const out: Aircraft[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const ac = normalizeAdsbRow(row, bbox);
      if (!ac || seen.has(ac.icao24)) continue;
      seen.add(ac.icao24);
      out.push(ac);
    }
    return out;
  }
}
