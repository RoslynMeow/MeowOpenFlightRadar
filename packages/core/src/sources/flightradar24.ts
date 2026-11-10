import { inBBox, type Aircraft, type AircraftKind, type Airport, type BBox } from '../shared/index.js';
import type { AircraftSource } from './types.js';
import { UpstreamError } from './types.js';

const API_URL = 'https://fr24api.flightradar24.com/api/live/flight-positions/full';
const FEED_HOSTS = ['https://data-cloud.flightradar24.com', 'https://data-live.flightradar24.com'];
const FEED_PATH = '/zones/fcgi/feed.js';
const MAX_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = 15000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const HEAVY_TYPES = new Set([
  'A124', 'A225', 'A332', 'A333', 'A337', 'A338', 'A339', 'A342', 'A343', 'A345', 'A346', 'A35K', 'A388',
  'B742', 'B743', 'B744', 'B748', 'B762', 'B763', 'B764', 'B772', 'B773', 'B77L', 'B77W', 'B78X', 'IL76',
  'MD11', 'C5M', 'C17', 'A400',
]);

const HELICOPTER_PREFIXES = ['EC', 'AS', 'AW', 'UH', 'H1', 'H2', 'H4', 'H6', 'R2', 'R4', 'R6', 'B06', 'B407', 'B412', 'MI'];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

/** FlightRadar24 适配器需要的本地数据依赖。 */
export interface FlightRadar24Deps {
  getAirport(ident: string): Airport | null;
  /** 官方 API token；默认读 `FR24_API_TOKEN`。 */
  token?: string;
}

function airportRef(
  icaoRaw: unknown,
  iataRaw: unknown,
  getAirport: FlightRadar24Deps['getAirport'],
): { icao: string | null; iata: string | null } | null {
  let icao = asString(icaoRaw)?.toUpperCase() ?? null;
  let iata = asString(iataRaw)?.toUpperCase() ?? null;
  if (!icao || !iata) {
    const a = getAirport(icao ?? iata ?? '');
    if (a) {
      icao = icao ?? a.ident;
      iata = iata ?? a.iata;
    }
  }
  return icao || iata ? { icao, iata } : null;
}

function resolveAirportCodes(
  code: unknown,
  getAirport: FlightRadar24Deps['getAirport'],
): { icao: string | null; iata: string | null } | null {
  const key = asString(code)?.toUpperCase();
  if (!key) return null;
  const a = getAirport(key);
  if (a) return { icao: a.ident, iata: a.iata };
  return {
    icao: /^[A-Z0-9]{4}$/.test(key) ? key : null,
    iata: /^[A-Z]{3}$/.test(key) ? key : null,
  };
}

function kindFor(typeCode: string | null): AircraftKind | null {
  if (!typeCode) return null;
  if (typeCode === 'GLID') return 'glider';
  if (HELICOPTER_PREFIXES.some((p) => typeCode.startsWith(p))) return 'helicopter';
  if (HEAVY_TYPES.has(typeCode)) return 'heavy';
  return null;
}

function normalizeRow(
  row: unknown[],
  bbox: BBox,
  getAirport: FlightRadar24Deps['getAirport'],
): Aircraft | null {
  const hex = asString(row[0])?.toLowerCase();
  if (!hex) return null;
  const lat = asNumber(row[1]);
  const lon = asNumber(row[2]);
  if (lat === null || lon === null || !inBBox(lat, lon, bbox)) return null;

  const altFt = asNumber(row[4]);
  const onGround = row[14] === 1 || altFt === 0;
  const typeCode = asString(row[8]);
  const callsign = asString(row[16]) ?? asString(row[13]);

  return {
    icao24: hex,
    callsign,
    lat,
    lon,
    altFt,
    altGeomFt: null,
    groundSpeedKt: asNumber(row[5]),
    trackDeg: asNumber(row[3]),
    verticalRateFpm: asNumber(row[15]),
    onGround,
    originCountry: null,
    category: null,
    registration: asString(row[9]),
    typeCode,
    model: null,
    kind: kindFor(typeCode),
    operator: asString(row[18]),
    origin: resolveAirportCodes(row[11], getAirport),
    destination: resolveAirportCodes(row[12], getAirport),
    squawk: asString(row[6]),
    seenPos: null,
    source: 'flightradar24',
    predictable: true,
  };
}

function normalizeApiFlight(
  f: Record<string, unknown>,
  getAirport: FlightRadar24Deps['getAirport'],
): Aircraft | null {
  const hex = asString(f.hex)?.toLowerCase();
  const lat = asNumber(f.lat);
  const lon = asNumber(f.lon);
  if (!hex || lat === null || lon === null) return null;

  const altFt = asNumber(f.alt);
  const gs = asNumber(f.gspeed);
  const typeCode = asString(f.type);
  const ts = asString(f.timestamp);
  const seenPos = ts && Number.isFinite(Date.parse(ts)) ? Math.max(0, Math.round((Date.now() - Date.parse(ts)) / 1000)) : null;

  return {
    icao24: hex,
    callsign: asString(f.callsign) ?? asString(f.flight),
    lat,
    lon,
    altFt,
    altGeomFt: null,
    groundSpeedKt: gs,
    trackDeg: asNumber(f.track),
    verticalRateFpm: asNumber(f.vspeed),
    onGround: altFt === 0 && (gs ?? 0) < 50,
    originCountry: null,
    category: null,
    registration: asString(f.reg),
    typeCode,
    model: null,
    kind: kindFor(typeCode),
    operator: asString(f.operating_as) ?? asString(f.painted_as),
    origin: airportRef(f.orig_icao, f.orig_iata, getAirport),
    destination: airportRef(f.dest_icao, f.dest_iata, getAirport),
    squawk: asString(f.squawk),
    seenPos,
    source: 'flightradar24',
    predictable: true,
  };
}

export class FlightRadar24Source implements AircraftSource {
  readonly id = 'flightradar24';
  private readonly token: string;
  private apiErrorLogged = false;

  constructor(private readonly deps: FlightRadar24Deps) {
    this.token = deps.token ?? process.env.FR24_API_TOKEN?.trim() ?? '';
  }

  async fetchAircraft(bbox: BBox): Promise<Aircraft[]> {
    if (this.token) {
      try {
        return await this.fetchViaApi(bbox);
      } catch (e) {
        if (e instanceof UpstreamError && e.status === 429) throw e;
        if (!this.apiErrorLogged) {
          this.apiErrorLogged = true;
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[flightradar24] API request failed, falling back to web feed: ${msg}`);
        }
      }
    }
    return this.fetchViaWeb(bbox);
  }

  private async fetchViaApi(bbox: BBox): Promise<Aircraft[]> {
    const params = new URLSearchParams({
      bounds: [bbox.lamax, bbox.lamin, bbox.lomin, bbox.lomax].join(','),
      limit: '3000',
    });
    const res = await fetch(`${API_URL}?${params.toString()}`, {
      headers: {
        accept: 'application/json',
        'accept-version': 'v1',
        authorization: `Bearer ${this.token}`,
        'user-agent': UA,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 429) throw new UpstreamError(429, 'flightradar24 API rate limited (429)');
    if (res.status !== 200) throw new UpstreamError(res.status || 502, `flightradar24 API HTTP ${res.status}`);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new UpstreamError(502, 'flightradar24: bad API JSON');
    }
    const rows = body && typeof body === 'object' ? (body as { data?: unknown }).data : null;
    if (!Array.isArray(rows)) return [];

    const out: Aircraft[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const ac = normalizeApiFlight(row as Record<string, unknown>, this.deps.getAirport);
      if (!ac || !inBBox(ac.lat, ac.lon, bbox) || seen.has(ac.icao24)) continue;
      seen.add(ac.icao24);
      out.push(ac);
    }
    return out;
  }

  private async fetchViaWeb(bbox: BBox): Promise<Aircraft[]> {
    const params = new URLSearchParams({
      faa: '1',
      satellite: '1',
      mlat: '1',
      flarm: '1',
      adsb: '1',
      gnd: '1',
      air: '1',
      vehicles: '0',
      estimated: '1',
      gliders: '1',
      maxage: '14400',
      limit: '1500',
      bounds: [bbox.lamax, bbox.lamin, bbox.lomin, bbox.lomax].join(','),
    });
    const query = params.toString();

    let lastStatus = 0;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      for (const host of FEED_HOSTS) {
        try {
          const res = await fetch(`${host}${FEED_PATH}?${query}`, {
            headers: {
              accept: 'application/json, text/javascript, */*; q=0.01',
              referer: 'https://www.flightradar24.com/',
              'user-agent': UA,
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          lastStatus = res.status;
          if (res.status === 200) {
            const text = await res.text();
            let feed: unknown;
            try {
              feed = JSON.parse(text);
            } catch {
              throw new UpstreamError(502, 'flightradar24: bad feed JSON');
            }
            return this.toAircraft(feed, bbox);
          }
          if (res.status === 429) throw new UpstreamError(429, 'flightradar24 rate limited (429)');
        } catch (e) {
          if (e instanceof UpstreamError && e.status === 429) throw e;
          if (!(e instanceof UpstreamError)) lastStatus = 502;
        }
      }
      if (attempt < MAX_ATTEMPTS - 1) await sleep(1000);
    }
    throw new UpstreamError(lastStatus || 502, `flightradar24 feed HTTP ${lastStatus}`);
  }

  private toAircraft(feed: unknown, bbox: BBox): Aircraft[] {
    if (!feed || typeof feed !== 'object') return [];
    const out: Aircraft[] = [];
    const seen = new Set<string>();
    for (const row of Object.values(feed as Record<string, unknown>)) {
      if (!Array.isArray(row) || row.length < 11) continue;
      const ac = normalizeRow(row, bbox, this.deps.getAirport);
      if (!ac || seen.has(ac.icao24)) continue;
      seen.add(ac.icao24);
      out.push(ac);
    }
    return out;
  }
}
