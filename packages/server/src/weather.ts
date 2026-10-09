import type { Weather, WeatherCloud, WeatherReport } from '@flightradar/shared';
import { TTLCache } from './cache.js';

const API = 'https://aviationweather.gov/api/data';
const CACHE_TTL_MS = 5 * 60 * 1000;
/** METAR 取最近多少小时。 */
const METAR_HOURS = 6;
/** TAF 取最近多少天（每天一条，逐日查询）。 */
const TAF_DAYS = 3;

const cache = new TTLCache<string, Weather>(CACHE_TTL_MS);

interface RawCloud {
  cover?: string;
  base?: number | null;
}

interface RawMetar {
  rawOb?: string;
  obsTime?: number;
  temp?: number;
  dewp?: number;
  wdir?: number | string;
  wspd?: number;
  wgst?: number | null;
  visib?: string | number;
  altim?: number;
  fltCat?: string;
  wxString?: string | null;
  clouds?: RawCloud[];
}

interface RawTaf {
  rawTAF?: string;
  issueTime?: string;
  validTimeFrom?: number;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function cloudsOf(c: RawCloud[] | undefined): WeatherCloud[] {
  return Array.isArray(c) ? c.map((x) => ({ cover: x.cover ?? '?', baseFt: num(x.base) })) : [];
}

function metarReport(m: RawMetar): WeatherReport {
  const wdir = m.wdir;
  return {
    kind: 'METAR',
    raw: m.rawOb ?? '',
    at: typeof m.obsTime === 'number' ? m.obsTime * 1000 : null,
    tempC: num(m.temp),
    dewpointC: num(m.dewp),
    windDirDeg: typeof wdir === 'number' ? wdir : null,
    windVar: wdir === 'VRB',
    windSpeedKt: num(m.wspd),
    windGustKt: num(m.wgst),
    visibility: m.visib != null ? String(m.visib) : null,
    altimHpa: num(m.altim),
    flightCategory: m.fltCat ?? null,
    weather: m.wxString ?? null,
    clouds: cloudsOf(m.clouds),
  };
}

function tafReport(t: RawTaf): WeatherReport {
  const at =
    t.issueTime != null && !Number.isNaN(Date.parse(t.issueTime))
      ? Date.parse(t.issueTime)
      : typeof t.validTimeFrom === 'number'
        ? t.validTimeFrom * 1000
        : null;
  return {
    kind: 'TAF',
    raw: t.rawTAF ?? '',
    at,
    tempC: null,
    dewpointC: null,
    windDirDeg: null,
    windVar: false,
    windSpeedKt: null,
    windGustKt: null,
    visibility: null,
    altimHpa: null,
    flightCategory: null,
    weather: null,
    clouds: [],
  };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** 最近 n 天的 UTC 日期（YYYY-MM-DD），含今天。 */
function recentDates(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * 机场 / 站点天气：最近多条 METAR（hours）+ 最近数天 TAF（date 逐日），来源 aviationweather.gov。
 * 结果按时间倒序，缓存 5 分钟。
 */
export async function getWeather(ident: string): Promise<Weather> {
  const key = ident.trim().toUpperCase();
  const hit = cache.get(key);
  if (hit) return hit;

  const [metars, ...tafArrs] = await Promise.all([
    fetchJson<RawMetar[]>(`${API}/metar?ids=${encodeURIComponent(key)}&format=json&hours=${METAR_HOURS}`).catch(
      () => null,
    ),
    ...recentDates(TAF_DAYS).map((d) =>
      fetchJson<RawTaf[]>(`${API}/taf?ids=${encodeURIComponent(key)}&format=json&date=${d}`).catch(() => null),
    ),
  ]);

  const reports: WeatherReport[] = [];
  for (const m of metars ?? []) if (m?.rawOb) reports.push(metarReport(m));
  for (const arr of tafArrs) for (const t of arr ?? []) if (t?.rawTAF) reports.push(tafReport(t));

  // 去重（同一原文）+ 按时间倒序
  const seen = new Set<string>();
  const unique = reports.filter((r) => (seen.has(r.raw) ? false : (seen.add(r.raw), true)));
  unique.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

  const out: Weather = { ident: key, time: Date.now(), reports: unique };
  if (unique.length) cache.set(key, out);
  return out;
}
