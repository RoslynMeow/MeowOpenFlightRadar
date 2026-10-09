import './style.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import type { LeafletMouseEvent } from 'leaflet';
import type { FeatureCollection } from 'geojson';
import { createMap } from 'meow-tile-kit';
import type { MeowMap } from 'meow-tile-kit';
import type { Aircraft, AircraftResult, Airport, AirportBoard, AirportFlight, AirportInfoResult, Navaid, NotamResult, TrackPoint, Weather, WeatherReport } from '@flightradar/shared';
import { aircraftStreamUrl, getAirport, getAirportFlights, getNotams, getRunwaysGeoJSON, getSettings, getTrack, getWeather, searchAirports, setProvider, updateViewport } from './api';
import type { AirportSummary, SettingsResponse } from './api';
import { AircraftLayer, categoryOf } from './layers/aircraft-layer';
import { AviationLayer, navaidLabel } from './layers/aviation-layer';
import { AirspaceLayer } from './layers/airspace-layer';
import { FirLayer } from './layers/fir-layer';
import { TrackLayer } from './layers/track-layer';
import { createRunwayLayer, pickRunway, RunwayOverlay } from './layers/runway-layer';
import { copyOffsets } from './wrap';

const ALLOWED_SOURCES = ['esri', 'osm', 'amap-sat'];
const DEFAULT_SOURCE = 'esri';

// 清掉历史遗留的图源 id（避免已移除的图源导致 createMap 报错）
try {
  const saved = localStorage.getItem('mkt-src');
  if (saved && !ALLOWED_SOURCES.includes(saved)) localStorage.removeItem('mkt-src');
} catch {
  /* ignore */
}

const app: MeowMap = createMap('map', {
  source: DEFAULT_SOURCE,
  center: [39.9, 116.4],
  zoom: 9,
  marker: false,
  drawer: false,
  panelOpen: false,
  scale: true,
  leaflet: L,
});
const map = app.map as L.Map;
app.setSource(DEFAULT_SOURCE); // 忽略本地记忆的图源，保证初始一致

// 天气层（风向标 + 天气悬浮框）：位于底图之上、其它叠加（跑道/机场/飞机等）之下
const weatherPane = map.createPane('weatherPane');
weatherPane.style.zIndex = '350';

// 数据来源署名：并入 Leaflet 版权控件（与底图 © Esri 写在一起，始终排在最后）
const DATA_ATTRIBUTION =
  '空域 © <a href="https://www.openaip.net" target="_blank" rel="noopener">openAIP</a> · ' +
  '情报区 © <a href="https://github.com/vatsimnetwork/vatspy-data-project" target="_blank" rel="noopener">VATSIM/VATSpy</a> · ' +
  '航班数据 © <a href="https://www.flightaware.com" target="_blank" rel="noopener">FlightAware</a>';
function refreshAttribution(): void {
  const ctrl = map.attributionControl;
  if (!ctrl) return;
  ctrl.removeAttribution(DATA_ATTRIBUTION);
  ctrl.addAttribution(DATA_ATTRIBUTION);
}
refreshAttribution();

const statusEl = document.getElementById('status')!;
const searchEl = document.getElementById('airport-search') as HTMLInputElement;
const searchResultsEl = document.getElementById('search-results')!;
const sourceEl = document.getElementById('source-select') as HTMLSelectElement;
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
const settingsModalEl = document.getElementById('settings-modal')!;
const settingsCloseEl = document.getElementById('settings-close') as HTMLButtonElement;
const providerSelect = document.getElementById('provider-select') as HTMLSelectElement;
const providerNote = document.getElementById('provider-note')!;
const calloutEl = document.getElementById('callout')!;
const calloutSvgEl = document.getElementById('callout-svg') as unknown as SVGSVGElement;
const airportDockEl = document.getElementById('airport-dock')!;
const adTitleEl = document.getElementById('ad-title')!;
const adSubEl = document.getElementById('ad-sub')!;
const fbBodyEl = document.getElementById('fb-body')!;
const fbCloseEl = document.getElementById('fb-close') as HTMLButtonElement;
const fbCollapseEl = document.getElementById('fb-collapse') as HTMLButtonElement;
const fbResetEl = document.getElementById('fb-reset') as HTMLButtonElement;

const aircraftLayer = new AircraftLayer(app);
aircraftLayer.addTo(map);
/** 每架选中飞机一条航迹（icao24 -> TrackLayer）。 */
const tracks = new Map<string, TrackLayer>();
const aviationLayer = new AviationLayer(app);
const airspaceLayer = new AirspaceLayer(app);
const firLayer = new FirLayer(app);
const runwayOverlay = new RunwayOverlay(app);

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

const clampLat = (n: number) => Math.max(-90, Math.min(90, n));

/** 经度归一化到 [-180,180)。 */
function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * 视野 bbox。地图可横向无限平移（世界副本），这里把西边界归一到 [-180,180)，
 * 东边界 = 西边界 + 视野跨度（可能 >180），由服务端按需要拆成跨日期变更线的多个子框。
 * 这样既能连续跨日期变更线拖动，又不会把落在另一侧的经度丢掉。
 */
function currentBBox(): string {
  const b = map.getBounds();
  let span = b.getEast() - b.getWest();
  if (!(span > 0)) span = 0.0001;
  if (span > 360) span = 360;
  const lomin = wrapLng(b.getWest());
  const lomax = lomin + span;
  return [clampLat(b.getSouth()), lomin, clampLat(b.getNorth()), lomax].map((n) => n.toFixed(4)).join(',');
}

function refreshOverlay(): void {
  const bbox = currentBBox();
  void aviationLayer.refresh(bbox);
  void airspaceLayer.refresh(bbox);
  void firLayer.refresh(bbox);
  void runwayOverlay.refresh(bbox);
}

// ── 跟随标注（可多个 + 可拖动） ──
type CalloutKind = 'aircraft' | 'airport' | 'sector' | 'navaid' | 'runway';
type AnchorFn = () => { x: number; y: number } | null;

interface Callout {
  id: string;
  kind: CalloutKind;
  box: HTMLDivElement;
  content: HTMLElement;
  halo: SVGLineElement;
  line: SVGLineElement;
  dot: SVGCircleElement;
  anchor: AnchorFn;
  /** 用户拖动后的固定屏幕坐标；null 表示自动跟随目标。 */
  manual: { x: number; y: number } | null;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const callouts = new Map<string, Callout>();
let calloutRaf: number | null = null;

/** 以 WGS-84 坐标作为锚点（随地图平移/缩放/换源重定位）。 */
function wgsAnchor(lat: number, lon: number): AnchorFn {
  return () => {
    const p = app.toLocal(lat, lon);
    const c = map.latLngToContainerPoint([p.lat, p.lng]);
    return { x: c.x, y: c.y };
  };
}

function ensureCalloutRaf(): void {
  if (calloutRaf !== null) return;
  const tick = (): void => {
    calloutRaf = null;
    layoutCallouts();
    if (callouts.size > 0) calloutRaf = requestAnimationFrame(tick);
  };
  calloutRaf = requestAnimationFrame(tick);
}

function upsertCallout(id: string, kind: CalloutKind, html: string, anchor: AnchorFn): Callout {
  let c = callouts.get(id);
  if (!c) {
    const box = document.createElement('div');
    box.className = 'callout-box';
    box.innerHTML =
      '<div class="callout-bar"><span class="callout-grip" title="拖动">⠿</span><span class="spacer"></span>' +
      '<button type="button" class="callout-close" title="关闭">✕</button></div>' +
      '<div class="callout-content"></div>' +
      '<span class="callout-resize" title="缩放"></span>';
    const content = box.querySelector<HTMLElement>('.callout-content')!;
    const halo = document.createElementNS(SVGNS, 'line');
    halo.setAttribute('class', 'callout-halo');
    const line = document.createElementNS(SVGNS, 'line');
    line.setAttribute('class', 'callout-line');
    const dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('class', 'callout-dot');
    dot.setAttribute('r', '4');
    calloutSvgEl.append(halo, line, dot);
    calloutEl.appendChild(box);
    c = { id, kind, box, content, halo, line, dot, anchor, manual: null };
    callouts.set(id, c);
    attachDrag(c);
    attachResize(c);
    box.querySelector('.callout-close')?.addEventListener('click', () => removeCallout(id));
  }
  c.kind = kind;
  c.anchor = anchor;
  c.content.innerHTML = html;
  ensureCalloutRaf();
  return c;
}

function removeCallout(id: string): void {
  const c = callouts.get(id);
  if (!c) return;
  c.box.remove();
  c.halo.remove();
  c.line.remove();
  c.dot.remove();
  callouts.delete(id);
  if (id.startsWith('ac:')) {
    const icao = id.slice(3);
    selectedIds.delete(icao);
    aircraftLayer.setSelected(selectedIds);
    const t = tracks.get(icao);
    if (t) {
      t.clear();
      tracks.delete(icao);
    }
  }
}

function layoutCallouts(): void {
  for (const c of callouts.values()) layoutCallout(c);
}

function layoutCallout(c: Callout): void {
  const a = c.anchor();
  if (!a) {
    c.box.style.display = 'none';
    c.halo.style.display = 'none';
    c.line.style.display = 'none';
    c.dot.style.display = 'none';
    return;
  }
  c.box.style.display = '';
  c.halo.style.display = '';
  c.line.style.display = '';
  c.dot.style.display = '';

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const bw = c.box.offsetWidth;
  const bh = c.box.offsetHeight;
  let bx: number;
  let by: number;
  if (c.manual) {
    bx = Math.max(0, Math.min(c.manual.x, vw - bw));
    by = Math.max(0, Math.min(c.manual.y, vh - bh));
  } else {
    const gap = 56; // 框挪远一些，避免压住飞机航迹（由引线连过去）
    bx = a.x + gap;
    if (bx + bw > vw - 8) bx = a.x - gap - bw;
    bx = Math.max(8, Math.min(bx, vw - bw - 8));
    by = a.y - bh / 2;
    by = Math.max(8, Math.min(by, vh - bh - 8));
  }
  c.box.style.left = `${bx}px`;
  c.box.style.top = `${by}px`;

  const ex = Math.max(bx, Math.min(a.x, bx + bw));
  const ey = Math.max(by, Math.min(a.y, by + bh));
  for (const l of [c.halo, c.line]) {
    l.setAttribute('x1', String(a.x));
    l.setAttribute('y1', String(a.y));
    l.setAttribute('x2', String(ex));
    l.setAttribute('y2', String(ey));
  }
  c.dot.setAttribute('cx', String(a.x));
  c.dot.setAttribute('cy', String(a.y));
}

function attachDrag(c: Callout): void {
  let drag: { dx: number; dy: number } | null = null;
  c.box.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('button, a, select, input, .fa-flight, .callout-resize')) return;
    const r = c.box.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    c.box.classList.add('dragging');
    c.box.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  c.box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    c.manual = {
      x: Math.max(0, Math.min(e.clientX - drag.dx, vw - c.box.offsetWidth)),
      y: Math.max(0, Math.min(e.clientY - drag.dy, vh - c.box.offsetHeight)),
    };
    layoutCallout(c);
  });
  const end = (e: PointerEvent): void => {
    if (!drag) return;
    drag = null;
    c.box.classList.remove('dragging');
    try {
      c.box.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  c.box.addEventListener('pointerup', end);
  c.box.addEventListener('pointercancel', end);
}

/** 右下角手柄：拖动改变信息框大小。 */
function attachResize(c: Callout): void {
  const handle = c.box.querySelector<HTMLElement>('.callout-resize');
  if (!handle) return;
  let start: { x: number; y: number; w: number; h: number } | null = null;
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    c.box.style.maxHeight = 'none'; // 允许放大超过默认上限
    start = { x: e.clientX, y: e.clientY, w: c.box.offsetWidth, h: c.box.offsetHeight };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!start) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    c.box.style.width = `${Math.max(200, Math.min(start.w + (e.clientX - start.x), vw - 20))}px`;
    c.box.style.height = `${Math.max(120, Math.min(start.h + (e.clientY - start.y), vh - 20))}px`;
    layoutCallout(c);
  });
  const end = (e: PointerEvent): void => {
    if (!start) return;
    start = null;
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

// ── 实时推流（单条稳定连接，拖动地图只更新视野，不重连） ──
const SID = Math.random().toString(36).slice(2) + Date.now().toString(36);
let es: EventSource | null = null;

function connect(): void {
  if (es) return;
  es = new EventSource(aircraftStreamUrl(currentBBox(), SID));
  es.addEventListener('open', () => {
    void updateViewport(SID, currentBBox());
  });
  es.addEventListener('aircraft', (ev) => {
    const data = JSON.parse((ev as MessageEvent).data) as AircraftResult;
    aircraftLayer.setAircraft(data.aircraft);
    lastAircraft = data.aircraft;
    updateHighlight();
    statusEl.textContent = `${data.aircraft.length} 架 · ${data.provider} · ${new Date(data.time).toLocaleTimeString()}`;
    // 刷新所有飞机标注的内容
    for (const c of callouts.values()) {
      if (c.kind !== 'aircraft') continue;
      const fresh = data.aircraft.find((a) => a.icao24 === c.id.slice(3));
      if (fresh) c.content.innerHTML = aircraftHtml(fresh);
    }
    // 追加所有选中飞机的航迹
    for (const [id, t] of tracks) {
      const fresh = data.aircraft.find((a) => a.icao24 === id);
      if (!fresh) continue;
      // 用「显示位置」追加，保证航迹末端与飞机一致（上报位置飞机还没到）
      const p = aircraftLayer.positionOf(id) ?? { lat: fresh.lat, lon: fresh.lon };
      t.append({
        t: data.time,
        lat: p.lat,
        lon: p.lon,
        altFt: fresh.altFt,
        trackDeg: fresh.trackDeg,
        onGround: fresh.onGround,
      });
    }
  });
  es.addEventListener('error', () => {
    statusEl.textContent = '数据源中断，重连中…';
  });
}

let moveTimer: number | undefined;
map.on('moveend', () => {
  window.clearTimeout(moveTimer);
  moveTimer = window.setTimeout(() => {
    void updateViewport(SID, currentBBox());
    refreshOverlay();
  }, 500);
});

// ── 选中飞机（可多选：每个选中项一个标注 + 一条航迹） ──
let selectedIds = new Set<string>();
let lastAircraft: Aircraft[] = [];

function selectAircraft(ac: Aircraft): void {
  selectedIds.add(ac.icao24);
  aircraftLayer.setSelected(selectedIds);
  // 优先跟随实时推算位置；若该机不在当前推流里，则用其上报坐标
  const anchor: AnchorFn = () => {
    const sp = aircraftLayer.screenPointFor(ac.icao24);
    if (sp) return sp;
    const q = app.toLocal(ac.lat, ac.lon);
    const c = map.latLngToContainerPoint([q.lat, q.lng]);
    return { x: c.x, y: c.y };
  };
  upsertCallout('ac:' + ac.icao24, 'aircraft', aircraftHtml(ac), anchor);
  ensureTrack(ac, true);
  void loadTrack(ac.icao24); // 拉取完整历史航迹（若有）
}

/** 确保某机有航迹层；fetch=true 时拉取服务端历史。 */
function ensureTrack(ac: Aircraft, fetch: boolean): void {
  if (tracks.has(ac.icao24)) return;
  const t = new TrackLayer(app);
  // 立即用当前位置起一条尾迹，避免等服务端航迹时看不到线
  t.setPoints([
    { t: Date.now(), lat: ac.lat, lon: ac.lon, altFt: ac.altFt, trackDeg: ac.trackDeg, onGround: ac.onGround },
  ]);
  tracks.set(ac.icao24, t);
  if (fetch) void loadTrack(ac.icao24);
  ensureTrackRaf();
}

/** 每帧把各航迹末端更新为飞机的显示位置，保证航迹贴着飞机。 */
let trackRaf: number | null = null;
let lastTrackTick = 0;
function ensureTrackRaf(): void {
  if (trackRaf !== null) return;
  const tick = (): void => {
    trackRaf = null;
    const now = performance.now();
    if (now - lastTrackTick >= 33) {
      lastTrackTick = now;
      for (const [id, t] of tracks) {
        const p = aircraftLayer.positionOf(id);
        if (p) t.setLive(p.lat, p.lon);
      }
    }
    if (tracks.size > 0) trackRaf = requestAnimationFrame(tick);
  };
  trackRaf = requestAnimationFrame(tick);
}

async function loadTrack(icao24: string): Promise<void> {
  try {
    const res = await getTrack(icao24);
    const t = tracks.get(icao24);
    if (!t) return; // 已取消选中
    if (res.points.length >= 2) t.setPoints(res.points);
  } catch {
    /* 上游失败时保留本地尾迹 */
  }
}

function aircraftHtml(ac: Aircraft): string {
  const title = ac.callsign || ac.registration || ac.icao24.toUpperCase();
  const rows: Array<[string, string]> = [
    ['ICAO24', ac.icao24.toUpperCase()],
    ['机型', ac.model ? `${ac.model}${ac.typeCode ? ` (${ac.typeCode})` : ''}` : (ac.typeCode ?? '—')],
    ['注册号', ac.registration ?? '—'],
    ['运营人', ac.operator ?? '—'],
    ['起飞', fmtAirport(ac.origin)],
    ['目的', fmtAirport(ac.destination)],
    ['高度', ac.altFt === null ? '—' : `${ac.altFt.toLocaleString()} ft`],
    ['地速', ac.groundSpeedKt === null ? '—' : `${Math.round(ac.groundSpeedKt)} kt`],
    ['航向', ac.trackDeg === null ? '—' : `${Math.round(ac.trackDeg)}°`],
    ['升降率', ac.verticalRateFpm === null ? '—' : `${Math.round(ac.verticalRateFpm)} fpm`],
    ['状态', ac.onGround ? '地面' : '空中'],
    ['位置', `${ac.lat.toFixed(4)}, ${ac.lon.toFixed(4)}`],
  ];
  return (
    `<div class="title">${esc(title)}</div><dl>${rows
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
      .join('')}</dl>`
  );
}

/** 起降机场显示：ICAO / IATA。 */
function fmtAirport(a: { icao: string | null; iata: string | null } | null): string {
  if (!a) return '—';
  const parts = [a.icao, a.iata].filter(Boolean);
  return parts.length ? parts.join(' / ') : '—';
}

map.on('click', (e: LeafletMouseEvent) => {
  handleClick(e.containerPoint);
});

// ── 机场搜索（底部居中 + 结果列表） ──
let searchTimer: number | undefined;
let runwayLayers: L.GeoJSON[] = [];
let lastRunways: FeatureCollection | null = null;

function hideSearchResults(): void {
  searchResultsEl.classList.add('hidden');
  searchResultsEl.innerHTML = '';
}

function renderSearchResults(items: AirportSummary[]): void {
  if (!items.length) {
    searchResultsEl.innerHTML = '<div class="sr-empty">无结果</div>';
    searchResultsEl.classList.remove('hidden');
    return;
  }
  searchResultsEl.innerHTML = items
    .map(
      (a) =>
        `<button class="sr-item" data-ident="${esc(a.ident)}">` +
        `<b>${esc(a.ident)}</b>` +
        `<span class="sr-name">${esc(a.name)}</span>` +
        `<span class="sr-muni">${esc(a.municipality ?? '')}</span>` +
        `</button>`,
    )
    .join('');
  searchResultsEl.classList.remove('hidden');
  searchResultsEl.querySelectorAll<HTMLElement>('.sr-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-ident') ?? '';
      searchEl.value = id;
      hideSearchResults();
      searchEl.blur();
      void loadAirport(id);
    });
  });
}

searchEl.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  const q = searchEl.value.trim();
  if (!q) {
    hideSearchResults();
    return;
  }
  searchTimer = window.setTimeout(async () => {
    try {
      renderSearchResults(await searchAirports(q));
    } catch {
      /* ignore */
    }
  }, 200);
});

searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const v = searchEl.value.trim();
    if (v) {
      hideSearchResults();
      void loadAirport(v);
    }
  } else if (e.key === 'Escape') {
    hideSearchResults();
  }
});

searchEl.addEventListener('blur', () => window.setTimeout(hideSearchResults, 150));
searchResultsEl.addEventListener('mousedown', (e) => e.preventDefault());

function drawRunways(geojson: FeatureCollection): void {
  lastRunways = geojson;
  for (const l of runwayLayers) map.removeLayer(l);
  runwayLayers = [];
  // 每个世界副本各铺一份，跨日期变更线拖动时所选机场跑道同样连续
  for (const off of copyOffsets(map)) {
    const layer = createRunwayLayer(app, geojson, off);
    layer.addTo(map);
    runwayLayers.push(layer);
  }
}

async function loadAirport(ident: string): Promise<void> {
  relatedAirport = ident; // 一次只开一个机场
  try {
    const [airport, geojson] = await Promise.all([getAirport(ident), getRunwaysGeoJSON(ident)]);
    currentAirportObj = airport;
    drawRunways(geojson);
    adTitleEl.textContent = airport.name;
    adSubEl.textContent = [airport.ident, airport.iata, airport.municipality, airport.isoCountry]
      .filter(Boolean)
      .join(' · ');
    // 把机场放在视口偏上位置，避免被底部面板遮住
    const c = app.toLocal(airport.lat, airport.lon);
    const zoom = Math.max(map.getZoom(), 12);
    const target = map.project(L.latLng(c.lat, c.lng), zoom);
    const center = map.unproject(target.add([0, map.getSize().y * 0.18]), zoom);
    map.setView(center, zoom);
    airportDockEl.classList.remove('hidden');
    updateWindRose(airport, null);
    updateWeatherBox(airport, null);
    void loadWeather(airport.ident);
    void loadAirportFlights(airport.ident);
  } catch (e) {
    currentAirportObj = null;
    clearWindRose();
    clearWeatherBox();
    adTitleEl.textContent = '未找到机场';
    adSubEl.textContent = ident;
    airportDockEl.classList.remove('hidden');
    relatedAirport = null;
    updateHighlight();
  }
}

// ── 天气填入风向标旁的悬浮框，并更新风向标。 ──
async function loadWeather(ident: string): Promise<void> {
  try {
    const wx = await getWeather(ident);
    if (relatedAirport !== ident) return; // 已切换到其它机场
    if (currentAirportObj) {
      updateWindRose(currentAirportObj, wx);
      updateWeatherBox(currentAirportObj, wx);
    }
  } catch (e) {
    if (relatedAirport !== ident) return;
    if (currentAirportObj) updateWeatherBox(currentAirportObj, null, e instanceof Error ? e.message : String(e));
  }
}

/** 飞行条件对应的罗盘配色类（国际标准：VFR 绿 / MVFR 蓝 / IFR 红 / LIFR 品红）。 */
function flightCatClass(cat: string | null | undefined): string {
  switch (cat) {
    case 'VFR':
      return 'cat-vfr';
    case 'MVFR':
      return 'cat-mvfr';
    case 'IFR':
      return 'cat-ifr';
    case 'LIFR':
      return 'cat-lifr';
    default:
      return 'cat-none';
  }
}

function reportTime(r: WeatherReport): string {
  if (!r.at) return '';
  const d = new Date(r.at);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}Z`;
}

/** 一条报文：要素已画到罗盘上，这里只放原文。 */
function weatherSection(kind: 'METAR' | 'TAF', r: WeatherReport): string {
  return (
    `<div class="wx-sec">` +
    `<div class="wx-sec-h"><span class="wx-kind">${kind}</span><span class="wx-time">${esc(reportTime(r))}</span></div>` +
    `<div class="wx-raw">${esc(r.raw)}</div>` +
    `</div>`
  );
}

/** 机场信息（海拔 / 位置 / 类型）：置于罗盘左侧悬浮框顶部。 */
function airportInfoBlock(a: Airport): string {
  const rows: Array<[string, string]> = [
    ['类型', a.type.replace('_', ' ')],
    ['海拔', a.elevationFt === null ? '—' : `${a.elevationFt} ft`],
    ['位置', `${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}`],
  ];
  return (
    `<div class="wx-ap">` +
    rows.map(([k, v]) => `<div class="wx-ap-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('') +
    `</div>`
  );
}

/** 天气（机场信息 + METAR + TAF）合并为一个悬浮框，置于罗盘左侧。 */
let weatherMarker: L.Marker | null = null;

function updateWeatherBox(a: Airport, wx: Weather | null, error?: string): void {
  const p = app.toLocal(a.lat, a.lon);
  const ll: L.LatLngExpression = [p.lat, p.lng];
  const metar = wx?.reports.find((r) => r.kind === 'METAR') ?? null;
  const taf = wx?.reports.find((r) => r.kind === 'TAF') ?? null;

  let body = airportInfoBlock(a);
  if (error) {
    body += `<div class="fa-note fa-err">天气加载失败：${esc(error)}</div>`;
  } else if (!wx) {
    body += `<div class="fa-note">加载天气…</div>`;
  } else if (metar) {
    body += weatherSection('METAR', metar);
    if (taf) body += weatherSection('TAF', taf);
  } else {
    body += `<div class="fa-note">无 METAR / TAF</div>`;
  }

  const side = 186; // 罗盘半径之外的左侧偏移
  const icon = L.divIcon({
    className: 'weather-box-icon',
    html: `<div class="weather-box">${body}</div>`,
    iconSize: [270, 300],
    // 正左边、垂直大致与罗盘中心齐平
    iconAnchor: [270 + side, 120],
  });
  if (!weatherMarker) {
    weatherMarker = L.marker(ll, { pane: 'weatherPane', icon, interactive: true }).addTo(map);
  } else {
    weatherMarker.setLatLng(ll);
    weatherMarker.setIcon(icon);
  }
}

function clearWeatherBox(): void {
  if (weatherMarker) {
    map.removeLayer(weatherMarker);
    weatherMarker = null;
  }
}

// ── 机场上的风玫瑰（罗盘） ──
let currentAirportObj: Airport | null = null;
let windRoseMarker: L.Marker | null = null;

/** 风羽（barb）：5kt 短斜线，10kt 长斜线，50kt 三角旗。 */
function windBarbs(spd: number): string {
  let remain = spd;
  const parts: string[] = [];
  let y = 44;
  while (remain >= 50) {
    parts.push(`<polygon class="wr-barb-pennant" points="170,${y} 192,${y + 7} 170,${y + 14}"/>`);
    remain -= 50;
    y += 20;
  }
  while (remain >= 10) {
    parts.push(`<line class="wr-barb" x1="170" y1="${y}" x2="190" y2="${y - 12}"/>`);
    remain -= 10;
    y += 14;
  }
  if (remain >= 5) {
    parts.push(`<line class="wr-barb wr-barb-half" x1="170" y1="${y}" x2="181" y2="${y - 7}"/>`);
  }
  return parts.join('');
}

/** 不定风（VRB）：中心画旋转圈示意，不显示方向箭头。 */
function vrbSymbol(): string {
  const arc = (rot: number): string =>
    `<path class="wr-vrb" d="M 184 170 A 14 14 0 1 1 156 170" transform="rotate(${rot} 170 170)"/>`;
  return (
    arc(20) +
    arc(200) +
    `<polygon class="wr-vrb-head" points="184,170 177,163 177,177"/>` +
    `<polygon class="wr-vrb-head" points="156,170 163,163 163,177"/>`
  );
}

/** 罗盘圈内顶/底的温度（+露点）与气压读数。 */
function compassReadouts(m: WeatherReport): string {
  let td = '';
  if (m.tempC != null) {
    const t = `${m.tempC}°`;
    const dew = m.dewpointC != null ? `/${m.dewpointC}°` : '';
    td = `<text class="wr-readout" x="170" y="112" text-anchor="middle">${esc(`${t}${dew}`)}</text>`;
  }
  const q =
    m.altimHpa != null
      ? `<text class="wr-readout" x="170" y="236" text-anchor="middle">${esc(`${m.altimHpa} hPa`)}</text>`
      : '';
  return td + q;
}

/** 风向符号：有方向→金色箭头+风羽；VRB→旋转圈；静风→小圆圈；无数据→灰色空杆。 */
function windSymbol(m: WeatherReport | null, rot: number, spd: number | null): string {
  if (!m) return '';
  if (m.windVar) return vrbSymbol();
  if (m.windDirDeg == null && spd == null) {
    return `<line class="wr-nodata" x1="170" y1="42" x2="170" y2="166"/>`;
  }
  if (spd === 0) return `<circle class="wr-calm" cx="170" cy="170" r="9"/>`;
  const barbs = spd != null && spd >= 5 ? windBarbs(spd) : '';
  return (
    `<g class="wr-arrow" transform="rotate(${rot} 170 170)">` +
    `<line x1="170" y1="36" x2="170" y2="160"/>` +
    `<polygon points="170,176 154,124 186,124"/>` +
    barbs +
    `</g>`
  );
}

function windRoseHtml(m: WeatherReport | null): string {
  const dir = m && !m.windVar ? m.windDirDeg : null;
  const spd = m?.windSpeedKt ?? null;
  const gust = m?.windGustKt ?? null;
  const label = m
    ? `${m.windVar ? 'VRB' : dir != null ? `${dir}°` : '—'}${spd != null ? ` ${spd}kt` : ''}${gust != null ? ` G${gust}` : ''}`
    : '—';
  const rot = dir != null ? dir : 0;
  let ticks = '';
  for (let d = 0; d < 360; d += 10) {
    const rad = ((d - 90) * Math.PI) / 180;
    const card = d % 90 === 0;
    const mid = d % 30 === 0;
    const r1 = 130;
    const r2 = card ? 150 : mid ? 143 : 136;
    const x1 = (170 + r1 * Math.cos(rad)).toFixed(1);
    const y1 = (170 + r1 * Math.sin(rad)).toFixed(1);
    const x2 = (170 + r2 * Math.cos(rad)).toFixed(1);
    const y2 = (170 + r2 * Math.sin(rad)).toFixed(1);
    ticks += `<line class="${card ? 'wr-tick-card' : mid ? 'wr-tick-mid' : 'wr-tick'}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  return (
    `<div class="wind-rose ${flightCatClass(m?.flightCategory)}">` +
    (m?.flightCategory ? `<div class="wr-cat">${esc(m.flightCategory)}</div>` : '') +
    `<svg viewBox="0 0 340 340" width="340" height="340">` +
    `<circle class="wr-ring" cx="170" cy="170" r="150"/>` +
    `<circle class="wr-ring2" cx="170" cy="170" r="130"/>` +
    ticks +
    `<text class="wr-letter" x="170" y="22" text-anchor="middle">N</text>` +
    `<text class="wr-letter" x="330" y="176" text-anchor="middle">E</text>` +
    `<text class="wr-letter" x="170" y="336" text-anchor="middle">S</text>` +
    `<text class="wr-letter" x="10" y="176" text-anchor="middle">W</text>` +
    (m ? compassReadouts(m) : '') +
    windSymbol(m, rot, spd) +
    `</svg>` +
    `<div class="wr-label">${esc(label)}</div>` +
    `</div>`
  );
}

function windRoseIcon(html: string): L.DivIcon {
  return L.divIcon({ className: 'wind-rose-icon', html, iconSize: [340, 340], iconAnchor: [170, 170] });
}

function updateWindRose(a: Airport, wx: Weather | null): void {
  const metar = wx?.reports.find((r) => r.kind === 'METAR') ?? null;
  const p = app.toLocal(a.lat, a.lon);
  const html = windRoseHtml(metar);
  if (!windRoseMarker) {
    windRoseMarker = L.marker([p.lat, p.lng], {
      pane: 'weatherPane',
      icon: windRoseIcon(html),
      interactive: false,
    }).addTo(map);
  } else {
    windRoseMarker.setLatLng([p.lat, p.lng]);
    windRoseMarker.setIcon(windRoseIcon(html));
  }
}

function clearWindRose(): void {
  if (windRoseMarker) {
    map.removeLayer(windRoseMarker);
    windRoseMarker = null;
  }
}

// ── 底部机场面板（航班板 + 机场信息/天气）+ 相关飞机高亮 ──
let relatedAirport: string | null = null;
let relatedIdents = new Set<string>();

fbCloseEl.addEventListener('click', () => {
  airportDockEl.classList.add('hidden');
  relatedAirport = null;
  relatedIdents.clear();
  currentAirportObj = null;
  clearWindRose();
  clearWeatherBox();
  updateHighlight();
});

/** 恢复默认布局：展开面板并取消拖动后的位置。 */
function resetDockLayout(): void {
  airportDockEl.classList.remove('collapsed');
  airportDockEl.style.left = '';
  airportDockEl.style.top = '';
  airportDockEl.style.bottom = '';
  airportDockEl.style.transform = '';
  fbCollapseEl.title = '折叠';
}

fbCollapseEl.addEventListener('click', () => {
  const collapsed = airportDockEl.classList.toggle('collapsed');
  fbCollapseEl.title = collapsed ? '展开' : '折叠';
});

fbResetEl.addEventListener('click', resetDockLayout);

// 面板可拖动（按住航班板标题栏）
{
  const head = airportDockEl.querySelector<HTMLElement>('.ad-head');
  if (head) {
    let drag: { dx: number; dy: number } | null = null;
    head.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const r = airportDockEl.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      airportDockEl.style.transform = 'none';
      head.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    head.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      airportDockEl.style.left = `${Math.max(0, Math.min(e.clientX - drag.dx, vw - airportDockEl.offsetWidth))}px`;
      airportDockEl.style.top = `${Math.max(0, Math.min(e.clientY - drag.dy, vh - airportDockEl.offsetHeight))}px`;
      airportDockEl.style.bottom = 'auto';
    });
    const end = (e: PointerEvent): void => {
      if (!drag) return;
      drag = null;
      try {
        head.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);

    // 双击左侧 ⠿ 回到默认位置（居中、底部）
    head.querySelector<HTMLElement>('.ad-grip')?.addEventListener('dblclick', resetDockLayout);
  }
}

/** 依据当前机场航班板 + 起降机场，高亮相关飞机，并只显示它们（航迹仅在点选时显示）。 */
function updateHighlight(): void {
  const set = new Set<string>();
  if (relatedAirport) {
    const ap = relatedAirport.toUpperCase();
    for (const ac of lastAircraft) {
      const cs = (ac.callsign ?? '').trim().toLowerCase();
      if ((cs && relatedIdents.has(cs)) || relatedIdents.has(ac.icao24)) {
        set.add(ac.icao24);
        continue;
      }
      const o = ac.origin;
      const d = ac.destination;
      const matches = (r: { icao: string | null; iata: string | null } | null): boolean =>
        !!r && ((!!r.icao && r.icao.toUpperCase() === ap) || (!!r.iata && r.iata.toUpperCase() === ap));
      if (matches(o) || matches(d)) set.add(ac.icao24);
    }
  }
  aircraftLayer.setHighlighted(set);
  // 只显示相关飞机；但若视野内没有相关飞机（或航班板尚未加载），则显示全部，避免地图变空。
  // 另外始终保证「已选中的飞机」可见（否则标注还在、图标却没了）。
  const visible = new Set(set);
  for (const id of selectedIds) visible.add(id);
  aircraftLayer.setVisibleIds(relatedAirport && set.size > 0 ? visible : null);
}

async function loadAirportFlights(ident: string): Promise<void> {
  relatedIdents.clear();
  updateHighlight();
  fbBodyEl.innerHTML = '<div class="fa-note">加载 FlightAware 航班板…</div>';
  airportDockEl.classList.remove('hidden');
  try {
    const res = await getAirportFlights(ident);
    if (relatedAirport !== ident) return; // 已切换到其它机场
    renderFlightBoard(res);
    updateHighlight();
  } catch (e) {
    if (relatedAirport !== ident) return;
    fbBodyEl.innerHTML = `<div class="fa-note fa-err">航班板加载失败：${esc(e instanceof Error ? e.message : e)}</div>`;
  }
}

/** 当前航班板数据（用于定时重算“现在”分割线）与解析出的机场时区偏移（分钟）。 */
let lastFlightRes: AirportInfoResult | null = null;
let airportTzOffsetMin: number | null = null;

/** 常见飞行时区缩写 → UTC 偏移（分钟）。歧义的（CST/IST/BST/AST）按国家再判断。 */
const TZ_ABBREV_MIN: Record<string, number> = {
  UTC: 0, GMT: 0, UT: 0, Z: 0,
  WET: 0, WEST: 60, CET: 60, CEST: 120, MET: 60, MEST: 120, EET: 120, EEST: 180, MSK: 180,
  EST: -300, EDT: -240, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420,
  AKST: -540, AKDT: -480, HST: -600, HADT: -540, NST: -210, NDT: -150,
  BRT: -180, BRST: -120, ART: -180, CLT: -240, CLST: -180, PET: -300, COT: -300, VET: -240,
  WAT: 60, CAT: 120, EAT: 180, SAST: 120, GST: 240, AFT: 270, IRST: 210, IRDT: 270,
  PKT: 300, NPT: 345, BDT: 360, MMT: 390, ICT: 420,
  WIB: 420, WITA: 480, WIT: 540, SGT: 480, HKT: 480, PHT: 480, JST: 540, KST: 540,
  AWST: 480, ACST: 570, ACDT: 630, AEST: 600, AEDT: 660, NZST: 720, NZDT: 780, CHST: 600,
};

function tzOffsetFor(abbrev: string | null, a: Airport | null): number | null {
  if (!abbrev) return null;
  const num = abbrev.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (num) {
    const sign = num[1] === '-' ? -1 : 1;
    return sign * (Number(num[2]) * 60 + Number(num[3] ?? 0));
  }
  const cc = (a?.isoCountry ?? '').toUpperCase();
  if (abbrev === 'CST') {
    if (['CN', 'TW', 'HK', 'MO'].includes(cc)) return 480;
    if (['US', 'CA', 'MX', 'GT', 'HN', 'SV', 'NI', 'CR', 'PA', 'BZ'].includes(cc)) return -360;
    if (cc === 'CU') return -300;
    return 480;
  }
  if (abbrev === 'IST') {
    if (cc === 'IN' || cc === 'LK') return 330;
    if (cc === 'IL') return 120;
    if (cc === 'IE') return 60;
    return 330;
  }
  if (abbrev === 'BST') return cc === 'BD' ? 360 : 60;
  if (abbrev === 'AST') return ['SA', 'AE', 'QA', 'KW', 'BH', 'IQ'].includes(cc) ? 180 : -240;
  if (Object.prototype.hasOwnProperty.call(TZ_ABBREV_MIN, abbrev)) return TZ_ABBREV_MIN[abbrev];
  return a ? Math.round(a.lon / 15) * 60 : null; // 兜底：按经度粗估
}

/** 从时间文本（如 `12:09a CST` / `05:38a +08`）取时区标识。 */
function timeZoneTag(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/\d{1,2}:\d{2}\s*[ap]?\.?m?\s*([A-Za-z]{2,5}|[+-]\d{1,2}(?::?\d{2})?)/i);
  return m ? m[1].toUpperCase() : null;
}

/** 机场本地的“现在”（当天分钟数 0..1439）；时区未知则 null。 */
function nowLocalMinutes(): number | null {
  if (airportTzOffsetMin == null) return null;
  const d = new Date();
  const utc = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (((utc + airportTzOffsetMin) % 1440) + 1440) % 1440;
}

/** 从航班板解析机场所处时区的 UTC 偏移（分钟）。 */
function resolveTzOffset(boards: AirportBoard[], a: Airport | null): number | null {
  for (const b of boards) {
    for (const f of b.flights) {
      for (const s of [f.depart, f.arrive]) {
        const off = tzOffsetFor(timeZoneTag(s), a);
        if (off != null) return off;
      }
    }
  }
  return null;
}

function fmtClock(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 解析 FlightAware 时间（如 `03:42p` / `12:02a` / `10:20AM`）为当天分钟数（按本机时区）。 */
function parseTimeToMinutes(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2}):(\d{2})\s*([ap])\.?m?/i) ?? s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = (m[3] ?? '').toLowerCase();
  if (ap.startsWith('p') && h < 12) h += 12;
  if (ap.startsWith('a') && h === 12) h = 0;
  return h * 60 + min;
}

function flightRow(f: AirportFlight, isTo: boolean, min: number | null): string {
  relatedIdents.add(f.ident.trim().toLowerCase());
  const o = f.other;
  // 只显示机场的 ICAO / IATA 代码，详细信息（全名）放悬浮提示。
  const icao = o?.icao ?? o?.code ?? o?.name ?? '';
  const iata = o?.iata && o.iata !== icao ? o.iata : '';
  const when = (isTo ? f.depart : f.arrive || f.depart) ?? '';
  const apTip = [o?.name, o?.code].filter(Boolean).join(' · ');
  const tyTip = [f.typeDesc, f.operator].filter(Boolean).join(' · ');
  return (
    `<tr class="fa-flight" data-ident="${esc(f.ident)}" data-min="${min ?? ''}">` +
    `<td class="fa-id" title="${esc(f.operator ?? '')}">${esc(f.ident)}</td>` +
    `<td class="fa-ty" title="${esc(tyTip)}">${esc(f.type ?? '')}</td>` +
    `<td class="fa-ap" title="${esc(apTip)}">` +
    `<span class="fa-dir">${isTo ? '→' : '←'}</span>` +
    `<span class="fa-icao">${esc(icao)}</span>` +
    (iata ? `<span class="fa-iata">${esc(iata)}</span>` : '') +
    `</td>` +
    `<td class="fa-tm">${esc(when)}</td>` +
    `</tr>`
  );
}

/** 把一个板块的航班按时间正序排列成行。 */
function collectRows(boards: AirportBoard[], isTo: boolean): Array<{ html: string; min: number | null }> {
  const items: Array<{ f: AirportFlight; min: number | null }> = [];
  for (const b of boards) {
    for (const f of b.flights.slice(0, 40)) {
      const when = (isTo ? f.depart : f.arrive || f.depart) ?? '';
      items.push({ f, min: parseTimeToMinutes(when) });
    }
  }
  items.sort((a, b) => (a.min ?? 99999) - (b.min ?? 99999));
  return items.map((it) => ({ html: flightRow(it.f, isTo, it.min), min: it.min }));
}

/** 板块排列顺序：到达 / 在途 / 离港 / 计划。 */
const BOARD_ORDER = ['arrivals', 'enroute', 'departures', 'scheduled'];
function boardRank(t: string): number {
  const i = BOARD_ORDER.indexOf(t);
  return i < 0 ? 99 : i;
}

/** 板块短表头，避免 FlightAware 的长标题把整列撑宽。 */
const BOARD_TITLE: Record<string, string> = {
  arrivals: 'Arrivals',
  enroute: 'EnRoute',
  departures: 'Departures',
  scheduled: 'Scheduled',
};

/** “现在”分割线的一行。 */
function nowDividerHtml(now: number): string {
  return `<tr class="fb-now"><td colspan="4"><span class="fb-now-label">现在 ${fmtClock(now)}</span></td></tr>`;
}

/** 每个板块各自一列（到达 / 在途 / 离港 / 计划），不再两两合并。 */
function renderBoardColumn(b: AirportBoard): string {
  const isTo = b.type === 'departures' || b.type === 'scheduled';
  let items = collectRows([b], isTo);
  // 在途 / 离港：按“离现在最近的一次”排序，并在“现在”处插入分割线（跨午夜也正确）
  if (b.type === 'enroute' || b.type === 'departures') {
    const now = nowLocalMinutes();
    if (now != null) {
      const withDelta = items.map((it) => ({
        ...it,
        delta: it.min == null ? null : ((((it.min - now + 720) % 1440) + 1440) % 1440) - 720,
      }));
      withDelta.sort((x, y) => (x.delta ?? 1e9) - (y.delta ?? 1e9));
      const idx = withDelta.findIndex((it) => it.delta != null && it.delta >= 0);
      withDelta.splice(idx < 0 ? withDelta.length : idx, 0, { html: nowDividerHtml(now), min: null, delta: null });
      items = withDelta;
    }
  }
  const rows = items.map((it) => it.html).join('');
  const title = BOARD_TITLE[b.type] ?? b.title;
  return (
    `<div class="fb-col" data-board="${esc(b.type)}">` +
    `<div class="fb-col-h">${esc(title)}<span class="fa-count">${b.flights.length}</span></div>` +
    `<table class="fb-table">${rows}</table>` +
    `</div>`
  );
}

function renderFlightBoard(res: AirportInfoResult): void {
  lastFlightRes = res;
  airportTzOffsetMin = resolveTzOffset(res.boards, currentAirportObj);
  relatedIdents = new Set();
  // 保留各列滚动位置（定时重算“现在”线时不要跳回顶部）
  const prevScroll = [...fbBodyEl.querySelectorAll<HTMLElement>('.fb-col')].map((c) => c.scrollTop);
  const boards = res.boards
    .filter((b) => b.flights.length)
    .sort((a, b) => boardRank(a.type) - boardRank(b.type));
  if (!boards.length) {
    fbBodyEl.innerHTML = '<div class="fa-note">FlightAware 暂无该机场航班板</div>';
    return;
  }
  fbBodyEl.innerHTML = boards.map(renderBoardColumn).join('');
  fbBodyEl.querySelectorAll<HTMLElement>('.fa-flight').forEach((el) => {
    el.addEventListener('click', () => selectFlight(el.getAttribute('data-ident') ?? ''));
  });
  fbBodyEl.querySelectorAll<HTMLElement>('.fb-col').forEach((col, i) => {
    col.scrollTop = prevScroll[i] ?? 0;
  });
  requestAnimationFrame(fitFlightBoard);
}

// 每 30s 重算一次“现在”分割线（机场本地时间在走）
setInterval(() => {
  if (!lastFlightRes || airportDockEl.classList.contains('hidden')) return;
  renderFlightBoard(lastFlightRes);
}, 30000);

/** 四列完整显示放不下时，切到紧凑模式（只留呼号 + ICAO）。 */
function fitFlightBoard(): void {
  fbBodyEl.classList.remove('compact');
  if (fbBodyEl.scrollWidth > fbBodyEl.clientWidth + 1) fbBodyEl.classList.add('compact');
}

let fitRaf: number | null = null;
window.addEventListener('resize', () => {
  if (airportDockEl.classList.contains('hidden') || fitRaf !== null) return;
  fitRaf = requestAnimationFrame(() => {
    fitRaf = null;
    fitFlightBoard();
  });
});

/** 点击航班板中的一条：把视角移到该机并选中（显示航迹）。 */
async function selectFlight(ident: string): Promise<void> {
  const key = ident.trim().toLowerCase();
  if (!key) return;
  const ac = lastAircraft.find((a) => a.icao24 === key);
  if (ac) {
    centerOnAircraft(ac);
    return;
  }
  // 不在当前视野：用其航迹最后一点定位，并选中
  try {
    const res = await getTrack(key);
    const p = res.points[res.points.length - 1];
    if (p) centerOnAircraft(aircraftFromTrack(ident, p));
  } catch {
    /* ignore */
  }
}

function centerOnAircraft(ac: Aircraft): void {
  const p = aircraftLayer.positionOf(ac.icao24) ?? { lat: ac.lat, lon: ac.lon };
  const c = app.toLocal(p.lat, p.lon);
  map.setView([c.lat, c.lng], Math.max(map.getZoom(), 11));
  selectAircraft(ac);
}

/** 用航迹点构造一个临时 Aircraft（用于不在当前推流里的航班）。 */
function aircraftFromTrack(ident: string, p: TrackPoint): Aircraft {
  return {
    icao24: ident.trim().toLowerCase(),
    callsign: ident,
    lat: p.lat,
    lon: p.lon,
    altFt: p.altFt,
    altGeomFt: null,
    groundSpeedKt: null,
    trackDeg: p.trackDeg,
    verticalRateFpm: null,
    onGround: p.onGround,
    originCountry: null,
    category: null,
    registration: null,
    typeCode: null,
    model: null,
    kind: null,
    operator: null,
    origin: null,
    destination: null,
    squawk: null,
    seenPos: null,
    source: 'track',
  };
}

// ── 管制分区 / 情报区：点击查看信息 + NOTAM ──
const AIRSPACE_TYPE: Record<number, string> = {
  0: '其它空域',
  1: '限制区 Restricted',
  2: '危险区 Danger',
  3: '禁飞区 Prohibited',
  4: '管制区 CTR',
  5: '应答机强制区 TMZ',
  6: '无线电强制区 RMZ',
  7: '终端管制区 TMA',
  8: '管制区 CTA',
  9: '航站情报区 TIZ',
};

function fmtLimit(x: unknown): string {
  const o = x as { v?: number | null; unit?: number | null } | null;
  if (!o || o.v == null) return '?';
  const unit = o.unit === 0 ? 'ft' : o.unit === 1 ? 'm' : '';
  return `${o.v}${unit}`;
}

interface SectorHit {
  kind: 'airspace' | 'fir';
  props: Record<string, unknown>;
}

/** 统一点击处理（优先级：机场 > 飞机 > 导航台 > 空域 > 情报区）。 */
function handleClick(cp: L.Point): void {
  const ident = aviationLayer.pick(cp);
  if (ident) {
    searchEl.value = ident;
    void loadAirport(ident);
    return;
  }
  const ac = aircraftLayer.pick(cp);
  if (ac) {
    selectAircraft(ac);
    return;
  }
  const ll = map.containerPointToLatLng(cp);
  // 点击可能落在世界副本上：经度归一到 [-180,180) 才能命中标准坐标系里的分区/情报区
  const w = app.toWgs84(ll.lat, wrapLng(ll.lng));
  const nv = aviationLayer.pickNavaid(cp);
  if (nv) {
    showNavaid(nv, w);
    return;
  }
  // 跑道优先于空域/情报区：点跑道只弹跑道信息，不再顺带选中扇区
  const rw = (lastRunways ? pickRunway(lastRunways.features, app, map, cp) : null) ?? runwayOverlay.pick(cp);
  if (rw) {
    showRunway(rw, w);
    return;
  }
  const airProps = airspaceLayer.pickLatLng(w.lat, w.lng);
  if (airProps) {
    showSector({ kind: 'airspace', props: airProps }, w);
    return;
  }
  const firProps = firLayer.pickLatLng(w.lat, w.lng);
  if (firProps) showSector({ kind: 'fir', props: firProps }, w);
}

/** 导航台类型中文名。 */
const NAVAID_TYPE: Record<string, string> = {
  VOR: 'VOR 全向信标',
  'VOR/DME': 'VOR/DME 台',
  VORTAC: 'VORTAC（VOR+TACAN）',
  TACAN: 'TACAN 战术导航台',
  DME: 'DME 测距仪',
  'DME-only': 'DME 测距仪',
  NDB: 'NDB 无方向信标',
  'NDB/DME': 'NDB/DME',
};

/** 导航台信息标注（单实例：点下一个台时替换）。 */
function showNavaid(n: Navaid, w: { lat: number; lng: number }): void {
  const rows: Array<[string, string]> = [];
  rows.push(['类型', NAVAID_TYPE[n.type] ?? n.type]);
  rows.push(['频率', navaidLabel(n)]);
  if (n.name) rows.push(['名称', n.name]);
  if (n.elevationFt != null) rows.push(['标高', `${Math.round(n.elevationFt)} ft`]);
  rows.push(['坐标', `${n.lat.toFixed(4)}, ${n.lon.toFixed(4)}`]);
  if (n.isoCountry) rows.push(['国家', n.isoCountry]);
  if (n.associatedAirport) rows.push(['关联机场', n.associatedAirport]);
  const html =
    `<div class="title">${esc(n.ident)}</div>` +
    `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  const callout = upsertCallout('navaid', 'navaid', html, wgsAnchor(w.lat, w.lng));
  const key = n.ident + '|' + n.type;
  if (callout.box.dataset.key !== key) {
    callout.box.dataset.key = key;
    callout.manual = null; // 切换台站：清掉拖动位置，重新贴到新锚点旁
  }
}

/** 跑道信息标注（单实例：点下一条跑道时替换）。 */
function showRunway(props: Record<string, unknown>, w: { lat: number; lng: number }): void {
  const txt = (v: unknown): string => (v == null || v === '' ? '—' : String(v));
  const measure = (v: unknown, unit: string): string => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? `${Math.round(n).toLocaleString()}${unit}` : '—';
  };
  const heading = (v: unknown): string => {
    const n = Number(v);
    return Number.isFinite(n) ? `${Math.round(n)}°` : '—';
  };
  const ident = txt(props.airport);
  const rwy = `${txt(props.le)}/${txt(props.he)}`;
  const rows: Array<[string, string]> = [
    ['长度', measure(props.lengthFt, ' ft')],
    ['宽度', measure(props.widthFt, ' ft')],
    ['道面', txt(props.surface)],
    ['真航向', `${heading(props.leHeading)} / ${heading(props.heHeading)}`],
    ['状态', props.closed ? '关闭' : '开放'],
  ];
  const html =
    `<div class="title">${esc(ident)} · RWY ${esc(rwy)}</div>` +
    `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  const callout = upsertCallout('runway', 'runway', html, wgsAnchor(w.lat, w.lng));
  const key = `${ident}|${rwy}`;
  if (callout.box.dataset.key !== key) {
    callout.box.dataset.key = key;
    callout.manual = null; // 切换跑道：清掉拖动位置，重新贴到新锚点旁
  }
}

function showSector(hit: SectorHit, w: { lat: number; lng: number }): void {
  const { kind, props } = hit;
  const title = String(props.name ?? props.id ?? '管制分区');
  const rows: Array<[string, string]> = [];
  if (kind === 'fir') {
    rows.push(['类型', 'FIR/UIR 情报区']);
    if (props.id) rows.push(['标识', String(props.id)]);
    if (props.region) rows.push(['区域', String(props.region)]);
    if (props.division) rows.push(['分区', String(props.division)]);
  } else {
    rows.push(['类型', AIRSPACE_TYPE[Number(props.type)] ?? `空域 (${String(props.type ?? '?')})`]);
    if (props.icaoClass != null && Number(props.icaoClass) <= 7) {
      rows.push(['ICAO 类别', String.fromCharCode(65 + Number(props.icaoClass))]);
    }
    rows.push(['下限', fmtLimit(props.lower)]);
    rows.push(['上限', fmtLimit(props.upper)]);
    if (props.country) rows.push(['国家', String(props.country)]);
  }
  const target = kind === 'fir' ? String(props.id ?? title) : title;
  const html =
    `<div class="title">${esc(title)}</div>` +
    `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` +
    `<div class="sector-notam notam"><div class="fa-note">加载 NOTAM…</div></div>`;
  // 扇区标注同一时间只保留一个：固定 id，点新扇区即替换（飞机仍可多选，各自独立 id）
  const callout = upsertCallout('sector', 'sector', html, wgsAnchor(w.lat, w.lng));
  const key = kind + ':' + title;
  if (callout.box.dataset.key !== key) {
    callout.box.dataset.key = key;
    callout.manual = null; // 切换扇区：清掉拖动位置，重新贴到新锚点旁
  }
  void loadNotams(target, callout.content);
}

async function loadNotams(target: string, content: HTMLElement): Promise<void> {
  const holder = content.querySelector<HTMLElement>('.sector-notam');
  if (!holder) return;
  try {
    const res = await getNotams(target);
    if (!holder.isConnected) return;
    renderNotams(holder, res);
  } catch (e) {
    if (!holder.isConnected) return;
    holder.innerHTML = `<div class="fa-note fa-err">NOTAM 加载失败：${esc(e instanceof Error ? e.message : e)}</div>`;
  }
}

function renderNotams(holder: HTMLElement, res: NotamResult): void {
  if (!res.available) {
    holder.innerHTML = `<div class="fa-note">${esc(res.message ?? '未接入 NOTAM 数据源')}</div>`;
    return;
  }
  if (!res.notams.length) {
    holder.innerHTML = '<div class="fa-note">当前无 NOTAM</div>';
    return;
  }
  holder.innerHTML =
    `<div class="fa-h">NOTAM<span class="fa-src">${esc(res.target)}</span></div>` +
    res.notams
      .map(
        (n) =>
          `<div class="notam-item"><div class="notam-h">${esc(n.id)}${n.kind ? ` · ${esc(n.kind)}` : ''}</div>` +
          `<div class="notam-t">${esc(n.text)}</div></div>`,
      )
      .join('');
}

// ── 图源切换 ──
sourceEl.value = app.getSourceId() || DEFAULT_SOURCE;
sourceEl.addEventListener('change', () => app.setSource(sourceEl.value));
app.on('sourcechange', () => {
  sourceEl.value = app.getSourceId();
  aircraftLayer.refresh();
  for (const t of tracks.values()) t.refresh();
  aviationLayer.invalidate();
  airspaceLayer.invalidate();
  firLayer.invalidate();
  runwayOverlay.invalidate();
  if (lastRunways) drawRunways(lastRunways);
  void updateViewport(SID, currentBBox());
  refreshOverlay();
  refreshAttribution();
});

// ── 设置模态框 ──
function openSettings(): void {
  settingsModalEl.classList.remove('hidden');
}
function closeSettings(): void {
  settingsModalEl.classList.add('hidden');
}
settingsBtn.addEventListener('click', openSettings);
settingsCloseEl.addEventListener('click', closeSettings);
settingsModalEl.querySelector('.modal-backdrop')?.addEventListener('click', closeSettings);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSettings();
});

// ── 图例折叠（记住状态） ──
const legendEl = document.getElementById('legend');
const legendHeader = document.getElementById('legend-header');
if (legendEl && legendHeader) {
  const LEGEND_KEY = 'fra-legend-collapsed';
  try {
    if (localStorage.getItem(LEGEND_KEY) === '1') legendEl.classList.add('collapsed');
  } catch {
    /* ignore */
  }
  legendHeader.setAttribute('aria-expanded', String(!legendEl.classList.contains('collapsed')));
  legendHeader.addEventListener('click', () => {
    const collapsed = legendEl.classList.toggle('collapsed');
    legendHeader.setAttribute('aria-expanded', String(!collapsed));
    try {
      localStorage.setItem(LEGEND_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  });
}

// ── 图例分类过滤：点击某项隐藏/显示该类飞机，关闭项置灰 ──
const hiddenCats = new Set<string>();
document.querySelectorAll<HTMLButtonElement>('#legend button.legend-item[data-cat]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const cat = btn.getAttribute('data-cat');
    if (!cat) return;
    if (hiddenCats.has(cat)) hiddenCats.delete(cat);
    else hiddenCats.add(cat);
    btn.classList.toggle('off', hiddenCats.has(cat));
    aircraftLayer.setHiddenCategories(hiddenCats);
    // 选中的飞机若被过滤掉，连同标注/航迹一起移除
    for (const id of [...selectedIds]) {
      const ac = lastAircraft.find((a) => a.icao24 === id);
      if (ac && hiddenCats.has(categoryOf(ac))) removeCallout('ac:' + id);
    }
  });
});

function renderProviders(settings: SettingsResponse): void {
  providerSelect.innerHTML = settings.providers
    .map((p) => {
      const disabled = p.requiresKey && !p.available;
      const label = `${p.label}${disabled ? '（未配置 key）' : ''}`;
      return `<option value="${p.id}"${p.id === settings.provider ? ' selected' : ''}${disabled ? ' disabled' : ''}>${label}</option>`;
    })
    .join('');
  const current = settings.providers.find((p) => p.id === settings.provider);
  providerNote.textContent = current?.note ?? '';
}

providerSelect.addEventListener('change', async () => {
  try {
    const settings = await setProvider(providerSelect.value);
    renderProviders(settings);
    es?.close();
    es = null;
    connect();
  } catch (e) {
    providerNote.textContent = `切换失败：${e instanceof Error ? e.message : e}`;
  }
});

getSettings()
  .then(renderProviders)
  .catch(() => {
    /* 服务端不可用时忽略 */
  });

connect();
refreshOverlay();
