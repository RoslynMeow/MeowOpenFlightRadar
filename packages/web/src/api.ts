import type { AircraftResult, Airport, AirportInfoResult, Navaid, NotamResult, TrackResult, Weather } from '@flightradar/shared';
import type { FeatureCollection } from 'geojson';

// Electron 通过 preload 注入 __FLIGHTRADAR__.apiBase；开发/浏览器下用 VITE_API_BASE 或同源。
const injected = (globalThis as { __FLIGHTRADAR__?: { apiBase?: string } }).__FLIGHTRADAR__?.apiBase;
const BASE = (injected ?? import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export interface AirportSummary {
  ident: string;
  iata: string | null;
  name: string;
  municipality?: string | null;
  type: string;
  lat: number;
  lon: number;
}

export async function fetchAircraft(bbox: string): Promise<AircraftResult> {
  const res = await fetch(`${BASE}/api/aircraft?bbox=${bbox}`);
  if (!res.ok) throw new Error(`aircraft HTTP ${res.status}`);
  return (await res.json()) as AircraftResult;
}

/** SSE 推流地址（实时飞机）。sid 用于在不重连的情况下更新视野。 */
export function aircraftStreamUrl(bbox: string, sid: string): string {
  return `${BASE}/event/aircraft?sid=${encodeURIComponent(sid)}&bbox=${bbox}`;
}

/** 更新当前 SSE 会话的视野 bbox（拖动地图时调用，不重连）。 */
export async function updateViewport(sid: string, bbox: string): Promise<void> {
  try {
    await fetch(`${BASE}/api/viewport?sid=${encodeURIComponent(sid)}&bbox=${bbox}`);
  } catch {
    /* ignore */
  }
}

export async function searchAirports(q: string): Promise<AirportSummary[]> {
  const res = await fetch(`${BASE}/api/airports?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`airports HTTP ${res.status}`);
  const body = (await res.json()) as { items: AirportSummary[] };
  return body.items;
}

export async function getAirport(ident: string): Promise<Airport> {
  const res = await fetch(`${BASE}/api/airports/${encodeURIComponent(ident)}`);
  if (!res.ok) throw new Error(`airport HTTP ${res.status}`);
  return (await res.json()) as Airport;
}

export async function getRunwaysGeoJSON(ident: string): Promise<FeatureCollection> {
  const res = await fetch(`${BASE}/api/airports/${encodeURIComponent(ident)}/runways.geojson`);
  if (!res.ok) throw new Error(`runways HTTP ${res.status}`);
  return (await res.json()) as FeatureCollection;
}

/** FlightAware 机场航班板（到达/出发/在途/计划）。 */
export async function getAirportFlights(ident: string): Promise<AirportInfoResult> {
  const res = await fetch(`${BASE}/api/airports/${encodeURIComponent(ident)}/flights`);
  if (!res.ok) throw new Error(`airport flights HTTP ${res.status}`);
  return (await res.json()) as AirportInfoResult;
}

export async function getTrack(icao24: string): Promise<TrackResult> {
  const res = await fetch(`${BASE}/api/tracks/${encodeURIComponent(icao24)}`);
  if (!res.ok) throw new Error(`track HTTP ${res.status}`);
  return (await res.json()) as TrackResult;
}

/** 视野内的机场（用于地图叠加）。 */
export async function fetchAirportsInBBox(bbox: string): Promise<AirportSummary[]> {
  const res = await fetch(`${BASE}/api/airports?bbox=${bbox}`);
  if (!res.ok) throw new Error(`airports HTTP ${res.status}`);
  return ((await res.json()) as { items: AirportSummary[] }).items;
}

/** 视野内的导航台（用于地图叠加）。 */
export async function fetchNavaidsInBBox(bbox: string): Promise<Navaid[]> {
  const res = await fetch(`${BASE}/api/navaids?bbox=${bbox}`);
  if (!res.ok) throw new Error(`navaids HTTP ${res.status}`);
  return ((await res.json()) as { items: Navaid[] }).items;
}

/** 视野内的空域（openAIP，GeoJSON）。 */
export async function fetchAirspace(bbox: string): Promise<FeatureCollection> {
  const res = await fetch(`${BASE}/api/airspace?bbox=${bbox}`);
  if (!res.ok) throw new Error(`airspace HTTP ${res.status}`);
  return (await res.json()) as FeatureCollection;
}

/** 视野内的跑道（GeoJSON LineString）。 */
export async function fetchRunwaysInBBox(bbox: string): Promise<FeatureCollection> {
  const res = await fetch(`${BASE}/api/runways?bbox=${bbox}`);
  if (!res.ok) throw new Error(`runways HTTP ${res.status}`);
  return (await res.json()) as FeatureCollection;
}

/** 视野内的 FIR/UIR 情报区边界（VATSIM/VATSpy）。 */
export async function fetchFir(bbox: string): Promise<FeatureCollection> {
  const res = await fetch(`${BASE}/api/fir?bbox=${bbox}`);
  if (!res.ok) throw new Error(`fir HTTP ${res.status}`);
  return (await res.json()) as FeatureCollection;
}

export interface ProviderInfo {
  id: string;
  label: string;
  requiresKey: boolean;
  available: boolean;
  note?: string;
}

export interface SettingsResponse {
  provider: string;
  providers: ProviderInfo[];
}

export async function getSettings(): Promise<SettingsResponse> {
  const res = await fetch(`${BASE}/api/settings`);
  if (!res.ok) throw new Error(`settings HTTP ${res.status}`);
  return (await res.json()) as SettingsResponse;
}

export async function setProvider(provider: string): Promise<SettingsResponse> {
  const res = await fetch(`${BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
  if (!res.ok) throw new Error(`settings HTTP ${res.status}`);
  return (await res.json()) as SettingsResponse;
}

/** 机场 / 站点天气（METAR + TAF）。 */
export async function getWeather(ident: string): Promise<Weather> {
  const res = await fetch(`${BASE}/api/weather/${encodeURIComponent(ident)}`);
  if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
  return (await res.json()) as Weather;
}

/** 管制分区 / 机场的 NOTAM（当前服务端为占位）。 */
export async function getNotams(q: string): Promise<NotamResult> {
  const res = await fetch(`${BASE}/api/notam?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`notam HTTP ${res.status}`);
  return (await res.json()) as NotamResult;
}
