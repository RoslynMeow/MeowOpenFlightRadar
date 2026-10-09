import * as cheerio from 'cheerio';
import {
  inBBox,
  type Aircraft,
  type AircraftKind,
  type AirportBoard,
  type AirportFlight,
  type BBox,
  type TrackPoint,
  type Weather,
  type WeatherReport,
} from '@flightradar/shared';
import type { AircraftSource } from './types.js';
import { UpstreamError } from './types.js';
import { getBrowserHostFactory, type BrowserHost } from './browser-host.js';
import { getAirport } from '../airports.js';
import { decodeMetar, tafIssuedMillis } from '../metar.js';

const VICINITY_URL = 'https://www.flightaware.com/ajax/vicinity_aircraft.rvt';
const FLIGHT_URL = 'https://www.flightaware.com/live/flight/';
const AIRPORT_URL = 'https://www.flightaware.com/live/airport/';
const AIRPORT_HTML_TTL_MS = 60 * 1000;
const MAX_ATTEMPTS = 3;

interface FaAirportRef {
  icao?: string | null;
  iata?: string | null;
}

interface FaFeatureProps {
  ident?: string;
  flight_id?: string;
  prefix?: string;
  type?: string;
  icon?: string;
  ga?: boolean;
  flightType?: string;
  direction?: number;
  altitude?: number;
  groundspeed?: number;
  origin?: FaAirportRef;
  destination?: FaAirportRef;
}

interface FaFeature {
  geometry?: { type?: string; coordinates?: number[] };
  properties?: FaFeatureProps;
}

interface FaGeoJSON {
  features?: FaFeature[];
}

interface FaTrackPoint {
  timestamp?: number;
  coord?: number[];
  alt?: number;
  gs?: number;
}

interface FaBootstrap {
  flights?: Record<string, { track?: FaTrackPoint[] } | undefined>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractBalancedObject(src: string, marker: string): string | null {
  const i = src.indexOf(marker);
  if (i < 0) return null;
  const start = src.indexOf('{', i);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  return null;
}

function parseJsonVar<T>(src: string, marker: string): T | null {
  const raw = extractBalancedObject(src, marker);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseJsonText<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function iconToKind(icon?: string, ga?: boolean): AircraftKind | null {
  switch (icon) {
    case 'helicopter':
      return 'helicopter';
    case 'glider':
      return 'glider';
    case 'heavy_2e':
    case 'heavy_3e':
    case 'heavy_4e':
      return 'heavy';
    case 'airliner':
    case 'jet_swept':
    case 'jet_nonswept':
      return 'jet';
    case 'cessna':
      return 'piston';
    case 'twin_small':
      return ga ? 'piston' : 'turboprop';
    case 'turboprop':
      return 'turboprop';
    default:
      return null;
  }
}

function normalizeFeature(f: FaFeature, bbox: BBox): Aircraft | null {
  const g = f.geometry;
  if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) return null;
  const lon = g.coordinates[0];
  const lat = g.coordinates[1];
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!inBBox(lat, lon, bbox)) return null;

  const p = f.properties ?? {};
  const ident = typeof p.ident === 'string' ? p.ident.trim() : '';
  if (!ident) return null;

  const altHundreds = typeof p.altitude === 'number' && Number.isFinite(p.altitude) ? p.altitude : null;
  const gs = typeof p.groundspeed === 'number' && Number.isFinite(p.groundspeed) ? p.groundspeed : null;
  const dir = typeof p.direction === 'number' && Number.isFinite(p.direction) ? p.direction : null;
  const typeCode = typeof p.type === 'string' && p.type ? p.type : null;
  const ga = p.ga === true;

  return {
    icao24: ident.toLowerCase(),
    callsign: ident,
    lat,
    lon,
    altFt: altHundreds === null ? null : Math.round(altHundreds * 100),
    altGeomFt: null,
    groundSpeedKt: gs,
    trackDeg: dir,
    verticalRateFpm: null,
    onGround: altHundreds === null || altHundreds === 0,
    originCountry: null,
    category: null,
    registration: ga ? ident : null,
    typeCode,
    model: null,
    kind: iconToKind(p.icon, ga),
    operator:
      (p.flightType === 'airline' || p.flightType === 'cargo') && typeof p.prefix === 'string' && p.prefix
        ? p.prefix
        : null,
    origin: p.origin ? { icao: p.origin.icao ?? null, iata: p.origin.iata ?? null } : null,
    destination: p.destination ? { icao: p.destination.icao ?? null, iata: p.destination.iata ?? null } : null,
    squawk: null,
    seenPos: null,
    source: 'flightaware',
    // 对齐 FlightAware 地图：帧间按上报位置插值，帧延迟时允许按速度/航向位位推算
    predictable: true,
  };
}

function cleanText(s: string | undefined | null): string {
  return (s ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 从 title（如 `Endeavor Air "Endeavor" (Minneapolis, MN)`）取运营人名。 */
function operatorName(title: string | undefined): string | null {
  const t = cleanText(title);
  if (!t) return null;
  const cut = t.split(/["(\u201c]/)[0].trim();
  return cut || t;
}

/** 用本地机场库把 FlightAware 显示的代码补全为 ICAO + IATA（查不到时按位数猜测）。 */
function resolveAirportCodes(code: string | null): { icao: string | null; iata: string | null } {
  const key = (code ?? '').trim().toUpperCase();
  if (!key) return { icao: null, iata: null };
  const a = getAirport(key);
  if (a) return { icao: a.ident, iata: a.iata };
  return {
    icao: /^[A-Z0-9]{4}$/.test(key) ? key : null,
    iata: /^[A-Z]{3}$/.test(key) ? key : null,
  };
}

/** 解析机场页的 4 个航班板（arrivals / departures / enroute / scheduled）。 */
function parseAirportBoards(html: string): AirportBoard[] {
  const $ = cheerio.load(html);
  const boards: AirportBoard[] = [];
  $('table.airportBoard[data-type]').each((_, table) => {
    const $t = $(table);
    const type = cleanText($t.attr('data-type'));
    if (!type) return;
    const title = cleanText($t.find('h2').first().text()).replace(/\s*\(more\)\s*$/i, '') || type;
    const flights: AirportFlight[] = [];
    $t.find('tr[id^="Row"]').each((__, tr) => {
      const tds = $(tr).find('td');
      if (tds.length < 3) return;
      const $id = tds.eq(0);
      const ident = cleanText($id.find('a').first().text()) || cleanText($id.text());
      if (!ident) return;
      const $ty = tds.eq(1);
      const $ot = tds.eq(2);
      const otherCode = cleanText($ot.find('a[href*="/live/airport/"]').first().text()) || null;
      const otherName =
        cleanText($ot.find('.hint span[dir="ltr"]').first().text()) ||
        cleanText($ot.find('.hint').first().text()) ||
        cleanText($ot.text()) ||
        null;
      const resolved = resolveAirportCodes(otherCode);
      flights.push({
        ident,
        type: cleanText($ty.find('a').first().text()) || cleanText($ty.text()) || null,
        typeDesc: cleanText($ty.find('span[title]').first().attr('title')) || null,
        operator: operatorName($id.find('span[title]').first().attr('title')),
        other:
          otherCode || otherName
            ? { name: otherName, code: otherCode, icao: resolved.icao, iata: resolved.iata }
            : null,
        depart: cleanText(tds.eq(3).text()) || null,
        arrive: cleanText(tds.eq(5).text()) || null,
      });
    });
    if (flights.length) boards.push({ type, title, flights });
  });
  return boards;
}

/** 机场页内嵌的 “PKX / ZBAD Weather” 块：原文 METAR + TAF。 */
function parseAirportWeatherHtml(html: string): WeatherReport[] {
  const $ = cheerio.load(html);
  const reports: WeatherReport[] = [];
  const box = $('h3')
    .filter((_, e) => /Weather/i.test($(e).text()) && !/More/i.test($(e).text()))
    .first()
    .parent();
  const text = (box.length ? box.html() ?? '' : '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const lines = text
    .split(/\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const seen = new Set<string>();
  for (const line of lines) {
    if (!/^[A-Z0-9]{4} \d{6}Z /.test(line)) continue; // 报头：ICAO + 发布时刻
    if (seen.has(line)) continue;
    seen.add(line);
    if (/\d{4}\/\d{4}/.test(line)) {
      // TAF（含 0800/0906 有效时段）
      reports.push({
        kind: 'TAF',
        raw: line,
        at: tafIssuedMillis(line),
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
      });
      continue;
    }
    const d = decodeMetar(line);
    reports.push({
      kind: 'METAR',
      raw: line,
      at: d.at,
      tempC: d.tempC,
      dewpointC: d.dewpointC,
      windDirDeg: d.windDirDeg,
      windVar: d.windVar,
      windSpeedKt: d.windSpeedKt,
      windGustKt: d.windGustKt,
      visibility: d.visibility,
      altimHpa: d.altimHpa,
      flightCategory: d.flightCategory,
      weather: d.weather,
      clouds: d.clouds,
    });
  }
  reports.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return reports;
}

/**
 * FlightAware 网页抓取源（非官方，仅供学习试用；请遵守其服务条款）。
 * 混合方案：Playwright 无头浏览器负责通过 Cloudflare 挑战并读取 VICINITY_TOKEN，
 * 数据请求走同一浏览器上下文的 context.request（复用 cf_clearance 与 UA/TLS 指纹，
 * 不渲染页面）。被挑战或 token 过期时自动重新过盾。
 *
 * 需要安装：`npm i playwright-core` 且 `npx playwright-core install chromium`。
 * vicinity 端点不提供 hexid，icao24 字段用 FlightAware 的 ident 代替。
 */
export class FlightAwareSource implements AircraftSource {
  readonly id = 'flightaware';

  private host: BrowserHost | null = null;
  private token: string | null = null;
  /** 机场页 HTML 缓存（航班板 + 天气共用一份）。 */
  private htmlCache = new Map<string, { html: string; at: number }>();

  private getHost(): BrowserHost {
    if (!this.host) this.host = getBrowserHostFactory()();
    return this.host;
  }

  private async ensureReady(force = false): Promise<void> {
    this.token = await this.getHost().ensureToken(force);
  }

  private async reqGet(url: string, accept: string): Promise<{ status: number; text: string }> {
    return this.getHost().fetchText(url, accept);
  }

  async fetchAircraft(bbox: BBox): Promise<Aircraft[]> {
    let lastStatus = 0;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        await this.ensureReady(attempt > 0);
        const q = new URLSearchParams({
          minLon: String(bbox.lomin),
          minLat: String(bbox.lamin),
          maxLon: String(bbox.lomax),
          maxLat: String(bbox.lamax),
          token: this.token!,
        });
        const { status, text } = await this.reqGet(
          `${VICINITY_URL}?${q.toString()}`,
          'application/json, text/javascript, */*; q=0.01',
        );
        lastStatus = status;
        if (status === 200) {
          const gj = parseJsonText<FaGeoJSON>(text);
          if (!gj) throw new UpstreamError(502, 'flightaware: bad vicinity JSON');
          return this.toAircraft(gj, bbox);
        }
        if (status === 429) throw new UpstreamError(429, 'flightaware rate limited (429)');
      } catch (e) {
        if (e instanceof UpstreamError) {
          if (e.status === 429) throw e;
          lastStatus = e.status;
        } else {
          await this.reset();
        }
      }
      if (attempt < MAX_ATTEMPTS - 1) await sleep(1000 + attempt * 1000);
    }
    throw new UpstreamError(lastStatus || 502, `flightaware vicinity HTTP ${lastStatus}`);
  }

  private toAircraft(gj: FaGeoJSON, bbox: BBox): Aircraft[] {
    const feats = Array.isArray(gj.features) ? gj.features : [];
    const out: Aircraft[] = [];
    const seen = new Set<string>();
    for (const f of feats) {
      const ac = normalizeFeature(f, bbox);
      if (!ac || seen.has(ac.icao24)) continue;
      seen.add(ac.icao24);
      out.push(ac);
    }
    return out;
  }

  async fetchTrack(icao24: string): Promise<TrackPoint[]> {
    const ident = icao24.trim();
    if (!ident) return [];
    let html = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.ensureReady(attempt > 0);
        const { status, text } = await this.reqGet(FLIGHT_URL + encodeURIComponent(ident), 'text/html,application/xhtml+xml');
        if (status === 200) {
          html = text;
          break;
        }
        if (status === 404) return [];
      } catch (e) {
        if (!(e instanceof UpstreamError)) await this.reset();
      }
      await sleep(800);
    }
    if (!html) return [];

    const boot = parseJsonVar<FaBootstrap>(html, 'trackpollBootstrap');
    const flights = boot?.flights;
    if (!flights) return [];
    const key = Object.keys(flights)[0];
    const track = key ? flights[key]?.track : undefined;
    if (!Array.isArray(track)) return [];

    const points: TrackPoint[] = [];
    for (const tp of track) {
      const coord = tp.coord;
      if (!Array.isArray(coord) || coord.length < 2) continue;
      const lon = coord[0];
      const lat = coord[1];
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      const altHundreds = typeof tp.alt === 'number' && Number.isFinite(tp.alt) ? tp.alt : null;
      points.push({
        t: typeof tp.timestamp === 'number' ? tp.timestamp * 1000 : Date.now(),
        lat,
        lon,
        altFt: altHundreds === null ? null : Math.round(altHundreds * 100),
        trackDeg: null,
        onGround: altHundreds === null || altHundreds === 0,
      });
    }
    return points;
  }

  /** 机场页 HTML（60s 缓存）：航班板与天气共用同一次抓取。 */
  private async airportHtml(icao: string): Promise<string> {
    const hit = this.htmlCache.get(icao);
    if (hit && Date.now() - hit.at < AIRPORT_HTML_TTL_MS) return hit.html;
    let html = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.ensureReady(attempt > 0);
        const { status, text } = await this.reqGet(AIRPORT_URL + encodeURIComponent(icao), 'text/html,application/xhtml+xml');
        if (status === 200) {
          html = text;
          break;
        }
        if (status === 404) return '';
      } catch (e) {
        if (!(e instanceof UpstreamError)) await this.reset();
      }
      await sleep(800);
    }
    if (html) this.htmlCache.set(icao, { html, at: Date.now() });
    return html;
  }

  async fetchAirportInfo(ident: string): Promise<AirportBoard[]> {
    const icao = cleanText(ident).toUpperCase();
    if (!icao) return [];
    const html = await this.airportHtml(icao);
    if (!html) return [];
    return parseAirportBoards(html);
  }

  /** 机场天气（METAR / TAF 原文，服务端解码），来自 FlightAware 机场页内嵌块。 */
  async fetchAirportWeather(ident: string): Promise<Weather> {
    const icao = cleanText(ident).toUpperCase();
    const html = icao ? await this.airportHtml(icao) : '';
    const reports = html ? parseAirportWeatherHtml(html) : [];
    if (!reports.length) throw new UpstreamError(404, 'flightaware: 机场页无 METAR/TAF');
    return { ident: icao, time: Date.now(), source: 'flightaware', reports };
  }

  private async reset(): Promise<void> {
    this.token = null;
    if (this.host) await this.host.reset();
  }

  async dispose(): Promise<void> {
    const h = this.host;
    this.host = null;
    this.token = null;
    if (h) await h.dispose();
  }
}
