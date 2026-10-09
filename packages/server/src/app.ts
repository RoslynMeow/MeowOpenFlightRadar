import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { isAircraftProvider, parseBBoxString, splitBBox, type Aircraft, type AirportBoard, type BBox, type TrackPoint, type Weather } from '@flightradar/shared';
import type { Feature, FeatureCollection } from 'geojson';
import { config } from './config.js';
import { TTLCache } from './cache.js';
import { TrackHistory } from './history.js';
import { AircraftPoller } from './poller.js';
import { SourceManager } from './manager.js';
import { listProviders } from './sources/index.js';
import { airportsInBBox, getAirport, hasAirportData, runwaysGeoJSON, runwaysInBBox, searchAirports } from './airports.js';
import { hasNavaidData, navaidsInBBox } from './navaids.js';
import { airspaceInBBox, hasAirspaceData } from './airspace.js';
import { firInBBox, hasFirData } from './fir.js';
import { getWeather } from './weather.js';
import { getNotams, hasNotamSource } from './notam.js';

const manager = new SourceManager(config.provider);
const cache = new TTLCache<string, Aircraft[]>(config.cacheTtlMs);
const airportInfoCache = new TTLCache<string, AirportBoard[]>(60000);
const history = new TrackHistory();
const poller = new AircraftPoller(() => manager.get(), history, config.pollIntervalMs);

/** SSE 会话：sid -> 当前订阅的 bbox key（拖动地图时通过 /api/viewport 更新，无需重连）。 */
const sessions = new Map<string, { key: string }>();

function cacheKey(bbox: BBox): string {
  return [bbox.lamin, bbox.lomin, bbox.lamax, bbox.lomax].map((n) => n.toFixed(2)).join(',');
}

/** 静态列表查询：跨 ±180 的 bbox 按需拆分后合并（客户端渲染仍是连续的一整块）。 */
function inBBoxParts<T>(bbox: BBox, fn: (b: BBox) => T[]): T[] {
  const parts = splitBBox(bbox);
  if (parts.length <= 1) return parts.length ? fn(parts[0]) : [];
  return parts.flatMap((p) => fn(p));
}

/** 静态 GeoJSON 查询：跨 ±180 的 bbox 按需拆分后合并 features。 */
function geoInBBoxParts(bbox: BBox, fn: (b: BBox) => FeatureCollection): FeatureCollection {
  const parts = splitBBox(bbox);
  if (parts.length <= 1) return parts.length ? fn(parts[0]) : { type: 'FeatureCollection', features: [] };
  const features: Feature[] = [];
  for (const p of parts) features.push(...fn(p).features);
  return { type: 'FeatureCollection', features };
}

async function fetchAircraft(bbox: BBox): Promise<Aircraft[]> {
  const key = cacheKey(bbox);
  const hit = cache.get(key);
  if (hit) return hit;
  const src = manager.get();
  const lists = await Promise.all(splitBBox(bbox).map((p) => src.fetchAircraft(p)));
  const seen = new Set<string>();
  const list: Aircraft[] = [];
  for (const arr of lists) {
    for (const a of arr) {
      if (seen.has(a.icao24)) continue;
      seen.add(a.icao24);
      list.push(a);
    }
  }
  history.record(list);
  cache.set(key, list);
  return list;
}

function result(aircraft: Aircraft[]) {
  return { time: Date.now(), provider: manager.getId(), count: aircraft.length, aircraft };
}

const app = new Hono();

app.use('*', cors({ origin: config.webOrigin }));

app.get('/health', (c) =>
  c.json({
    ok: true,
    provider: manager.getId(),
    hasAirportData: hasAirportData(),
    hasNavaidData: hasNavaidData(),
    hasAirspaceData: hasAirspaceData(),
    hasFirData: hasFirData(),
    hasNotamSource: hasNotamSource(),
  }),
);

// ── 设置：数据源切换 ──
app.get('/api/settings', (c) => c.json({ provider: manager.getId(), providers: listProviders() }));

app.put('/api/settings', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { provider?: unknown } | null;
  if (!isAircraftProvider(body?.provider)) return c.json({ error: 'invalid provider' }, 400);
  manager.set(body.provider);
  poller.clear();
  return c.json({ provider: manager.getId(), providers: listProviders() });
});

app.get('/api/aircraft', async (c) => {
  const bbox = parseBBoxString(c.req.query('bbox'));
  if (!bbox) return c.json({ error: 'invalid bbox, expected lamin,lomin,lamax,lomax' }, 400);
  try {
    return c.json(result(await fetchAircraft(bbox)));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

app.get('/api/airports', (c) => {
  const bbox = parseBBoxString(c.req.query('bbox'));
  if (bbox) {
    const items = inBBoxParts(bbox, (b) => airportsInBBox(b));
    return c.json({ count: items.length, items });
  }
  const q = c.req.query('q') ?? '';
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? 20) || 20));
  const items = searchAirports(q, limit).map((a) => ({
    ident: a.ident,
    iata: a.iata,
    name: a.name,
    municipality: a.municipality,
    type: a.type,
    lat: a.lat,
    lon: a.lon,
  }));
  return c.json({ count: items.length, items });
});

app.get('/api/navaids', (c) => {
  const bbox = parseBBoxString(c.req.query('bbox'));
  if (!bbox) return c.json({ error: 'invalid bbox, expected lamin,lomin,lamax,lomax' }, 400);
  const items = inBBoxParts(bbox, (b) => navaidsInBBox(b));
  return c.json({ count: items.length, items });
});

app.get('/api/airspace', (c) => {
  const bbox = parseBBoxString(c.req.query('bbox'));
  if (!bbox) return c.json({ error: 'invalid bbox, expected lamin,lomin,lamax,lomax' }, 400);
  return c.json(geoInBBoxParts(bbox, (b) => airspaceInBBox(b)));
});

app.get('/api/runways', (c) => {
  const bbox = parseBBoxString(c.req.query('bbox'));
  if (!bbox) return c.json({ error: 'invalid bbox, expected lamin,lomin,lamax,lomax' }, 400);
  return c.json(geoInBBoxParts(bbox, (b) => runwaysInBBox(b)));
});

app.get('/api/fir', (c) => {
  const bbox = parseBBoxString(c.req.query('bbox'));
  if (!bbox) return c.json({ error: 'invalid bbox, expected lamin,lomin,lamax,lomax' }, 400);
  return c.json(geoInBBoxParts(bbox, (b) => firInBBox(b)));
});

app.get('/api/airports/:ident', (c) => {
  const airport = getAirport(c.req.param('ident'));
  if (!airport) return c.json({ error: 'airport not found' }, 404);
  return c.json(airport);
});

app.get('/api/airports/:ident/runways.geojson', (c) => {
  const airport = getAirport(c.req.param('ident'));
  if (!airport) return c.json({ error: 'airport not found' }, 404);
  return c.json(runwaysGeoJSON(airport));
});

// FlightAware 机场航班板（到达/出发/在途/计划），60s 缓存
app.get('/api/airports/:ident/flights', async (c) => {
  const ident = c.req.param('ident').toUpperCase();
  const src = manager.get();
  if (!src.fetchAirportInfo) return c.json({ error: 'airport info not supported by current provider' }, 501);
  const cached = airportInfoCache.get(ident);
  if (cached) return c.json({ ident, provider: manager.getId(), time: Date.now(), boards: cached });
  try {
    const boards = await src.fetchAirportInfo(ident);
    airportInfoCache.set(ident, boards);
    return c.json({ ident, provider: manager.getId(), time: Date.now(), boards });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// ── 天气：机场 METAR / TAF（优先 FlightAware 机场页，回退 aviationweather.gov） ──
const faWeatherCache = new TTLCache<string, Weather>(5 * 60 * 1000);

app.get('/api/weather/:ident', async (c) => {
  const ident = c.req.param('ident').toUpperCase();
  const src = manager.get();
  if (src.fetchAirportWeather) {
    const hit = faWeatherCache.get(ident);
    if (hit) return c.json(hit);
    try {
      const wx = await src.fetchAirportWeather(ident);
      faWeatherCache.set(ident, wx);
      return c.json(wx);
    } catch {
      /* 回退 aviationweather.gov */
    }
  }
  try {
    return c.json(await getWeather(ident));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// ── NOTAM：管制分区 / 机场（当前为占位，见 notam.ts） ──
app.get('/api/notam', async (c) => {
  const target = c.req.query('q') ?? '';
  try {
    return c.json(await getNotams(target));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

app.get('/api/tracks/:icao24', async (c) => {
  const icao24 = c.req.param('icao24').toLowerCase();
  let points: TrackPoint[] = [];
  let origin: 'flightaware' | 'buffer' = 'buffer';

  const src = manager.get();
  if (src.fetchTrack) {
    try {
      const upstream = await src.fetchTrack(icao24);
      if (upstream.length >= 2) {
        points = upstream;
        origin = 'flightaware';
      }
    } catch {
      /* 上游失败则回退到位置缓冲 */
    }
  }
  if (points.length < 2) points = history.get(icao24);

  return c.json({ icao24, provider: manager.getId(), origin, count: points.length, points });
});

app.get('/event/aircraft', (c) => {
  const sid = c.req.query('sid') || Math.random().toString(36).slice(2);
  const bbox = parseBBoxString(c.req.query('bbox'));
  if (!bbox) return c.json({ error: 'invalid bbox, expected lamin,lomin,lamax,lomax' }, 400);
  c.header('Cache-Control', 'no-cache');
  return streamSSE(c, async (stream) => {
    let key = poller.subscribe(bbox);
    sessions.set(sid, { key });
    let lastSent = 0;
    let alive = true;

    stream.onAbort(() => {
      alive = false;
      const s = sessions.get(sid);
      if (s) {
        poller.unsubscribe(s.key);
        sessions.delete(sid);
      }
    });

    // 有缓存就立刻发首帧，不等上游
    const first = poller.getLatest(key);
    if (first) {
      await stream.writeSSE({ event: 'aircraft', data: JSON.stringify(first) });
      lastSent = first.time;
    }

    try {
      while (alive) {
        await stream.sleep(1000);
        if (!alive) break;

        // 会话视野可能已被 /api/viewport 更新
        const s = sessions.get(sid);
        if (s && s.key !== key) {
          poller.unsubscribe(key);
          key = s.key;
          lastSent = 0;
          const cached = poller.getLatest(key);
          if (cached) {
            await stream.writeSSE({ event: 'aircraft', data: JSON.stringify(cached) });
            lastSent = cached.time;
          }
          continue;
        }

        const r = poller.getLatest(key);
        if (r && r.time > lastSent) {
          await stream.writeSSE({ event: 'aircraft', data: JSON.stringify(r) });
          lastSent = r.time;
        }
      }
    } catch {
      /* 连接被中断 */
    }
  });
});

/** 更新某个 SSE 会话的视野 bbox（不重连）。 */
app.get('/api/viewport', (c) => {
  const sid = c.req.query('sid');
  const bbox = parseBBoxString(c.req.query('bbox'));
  if (!sid || !bbox) return c.json({ ok: false }, 400);
  const s = sessions.get(sid);
  if (!s) return c.json({ ok: false }, 404);
  const newKey = poller.subscribe(bbox);
  if (newKey === s.key) poller.unsubscribe(newKey); // 同一视野，抵消多余引用
  else {
    poller.unsubscribe(s.key);
    s.key = newKey;
  }
  return c.json({ ok: true });
});

/** 释放数据源（关闭 Chromium 等）。 */
export async function dispose(): Promise<void> {
  await manager.dispose();
}

/** 以独立进程启动 API 服务（`npm start` 用）。port 传 0 时用随机空闲端口。 */
export function startApiServer(port = config.port): ReturnType<typeof serve> {
  return serve({ fetch: app.fetch, port }, (info) => {
    console.log(
      `[server] http://localhost:${info.port}  provider=${manager.getId()}  airports=${hasAirportData() ? 'ok' : 'missing (run npm run import:airports)'}`,
    );
  });
}

export { app };
