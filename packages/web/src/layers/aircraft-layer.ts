import L from 'leaflet';
import type { Aircraft } from '@flightradar/shared';
import type { MeowMap } from 'meow-tile-kit';
import { worldPixelWidth, nearestCopyX } from '../wrap';

/** 地面飞机颜色。 */
export const GROUND_COLOR = '#c084fc';

export type ColorMode = 'altitude' | 'speed' | 'vrate';

export interface CatDef {
  key: string;
  label: string;
  color: string;
  match: (ac: Aircraft) => boolean;
}

/** 各配色模式的分类：顺序即匹配优先级，最后一项为兜底。 */
export const COLOR_MODES: Record<ColorMode, CatDef[]> = {
  altitude: [
    { key: 'noalt', label: '未报高度', color: '#ffffff', match: (a) => a.altFt === null },
    { key: 'ground', label: '地面', color: GROUND_COLOR, match: (a) => a.onGround },
    { key: 'b0', label: '<3000ft', color: '#ff9e2c', match: (a) => (a.altFt ?? 0) < 3000 },
    { key: 'b3', label: '3000–10000ft', color: '#ffe066', match: (a) => (a.altFt ?? 0) < 10000 },
    { key: 'b10', label: '10000–20000ft', color: '#63e07a', match: (a) => (a.altFt ?? 0) < 20000 },
    { key: 'b20', label: '20000–30000ft', color: '#41c7ff', match: (a) => (a.altFt ?? 0) < 30000 },
    { key: 'b30', label: '>30000ft', color: '#5aa9ff', match: () => true },
  ],
  speed: [
    { key: 'ground', label: '地面', color: GROUND_COLOR, match: (a) => a.onGround },
    { key: 's0', label: '<120kt', color: '#6ee7b7', match: (a) => a.groundSpeedKt !== null && a.groundSpeedKt < 120 },
    { key: 's1', label: '120–250kt', color: '#38bdf8', match: (a) => a.groundSpeedKt !== null && a.groundSpeedKt < 250 },
    { key: 's2', label: '250–400kt', color: '#a78bfa', match: (a) => a.groundSpeedKt !== null && a.groundSpeedKt < 400 },
    { key: 's3', label: '400–550kt', color: '#fb923c', match: (a) => a.groundSpeedKt !== null && a.groundSpeedKt < 550 },
    { key: 's4', label: '≥550kt', color: '#ef4444', match: () => true },
  ],
  vrate: [
    { key: 'ground', label: '地面', color: GROUND_COLOR, match: (a) => a.onGround },
    { key: 'climb', label: '爬升', color: '#4ade80', match: (a) => a.verticalRateFpm !== null && a.verticalRateFpm > 500 },
    { key: 'desc', label: '下降', color: '#f87171', match: (a) => a.verticalRateFpm !== null && a.verticalRateFpm < -500 },
    { key: 'level', label: '平飞 / 未知', color: '#94a3b8', match: () => true },
  ],
};

export function categoriesOf(mode: ColorMode): CatDef[] {
  return COLOR_MODES[mode] ?? COLOR_MODES.altitude;
}

/** 飞机分类（用于图例过滤），依据当前配色模式。 */
export function categoryOf(ac: Aircraft, mode: ColorMode = 'altitude'): string {
  for (const d of categoriesOf(mode)) if (d.match(ac)) return d.key;
  return 'unknown';
}

function colorFor(ac: Aircraft, mode: ColorMode): string {
  for (const d of categoriesOf(mode)) if (d.match(ac)) return d.color;
  return '#94a3b8';
}

/** 按平均高度取色（用于聚合点）。 */
function colorForAltitude(alt: number | null): string {
  if (alt === null) return '#ffffff';
  if (alt < 3000) return '#ff9e2c';
  if (alt < 10000) return '#ffe066';
  if (alt < 20000) return '#63e07a';
  if (alt < 30000) return '#41c7ff';
  return '#5aa9ff';
}

/** 图标整体放大系数（更清晰可见）。 */
const ICON_SCALE = 1.45;
/** 白色外发光描边宽度（深浅底图都醒目）。 */
const HALO_WIDTH = 3.2;

/** 节 → 米/秒（同 FlightAware：gs/3600*1852）。 */
const KT_TO_MS = 1852 / 3600;
/** 上报位置最大推算秒数（超时说明该机数据已陈旧）。 */
const MAX_EXTRAPOLATE_SEC = 120;
/** 上报坐标与锚点差超过该米数视为新位置（触发重锚）。 */
const NEW_PING_METERS = 2;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 从 (lat,lon) 沿真航向 track（度）前进 meters（米），返回新经纬度（小范围平面近似）。 */
function projectForward(lat: number, lon: number, track: number, meters: number): { lat: number; lon: number } {
  const rad = (track * Math.PI) / 180;
  const dLat = (meters * Math.cos(rad)) / 111320;
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLon = (meters * Math.sin(rad)) / (111320 * cosLat);
  return { lat: lat + dLat, lon: lon + dLon };
}

/**
 * 每架飞机的运动状态（对齐 FlightAware FAMap 的 _animateCallback 模型）：
 * 以**最后上报位置为锚点**，按地速 × 距锚定时间沿航迹角持续位位推算；
 * 收到新上报位置（坐标变化）就重设锚点。数据不动时动画照走，运动连续、不会到头停住。
 */
interface Motion {
  /** 锚点（最后一次真实上报位置）。 */
  anchorLat: number;
  anchorLon: number;
  /** 上一次收到的上报坐标（用于判断是否来了新位置）。 */
  repLat: number;
  repLon: number;
  /** 锚定时刻（performance.now 毫秒）。 */
  tAnchor: number;
  /** 推算用航迹角 / 地速（米/秒）；缺航向则不推算。 */
  trackDeg: number;
  hasTrack: boolean;
  gsMs: number;
  /** 数据源是否允许位位推算。 */
  predictable: boolean;
}

/**
 * 用一块 Canvas 绘制所有飞机（三角形，按航迹角旋转）。
 * 位置由 地速×时间 的位位推算动画驱动（同 FlightAware），标签在足够缩放时显示。
 * 坐标统一存 WGS-84，绘制时经 app.toLocal 投影后换算为画布像素。
 */
export class AircraftLayer extends L.Layer {
  private readonly app: MeowMap;
  private readonly dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private lmap: L.Map | null = null;
  private data: Aircraft[] = [];
  private motion = new Map<string, Motion>();
  private selected = new Set<string>();
  /** 与所选机场相关的飞机（航班板 / 起降机场匹配），画高亮环。 */
  private highlighted = new Set<string>();
  /** 若非 null，则只绘制这些飞机（选中机场时只看相关航班）。 */
  private visibleIds: Set<string> | null = null;
  /** 被图例过滤隐藏的分类（categoryOf 的键）。 */
  private hiddenCats = new Set<string>();
  /** 配色模式：高度 / 地速 / 升降率。 */
  private colorMode: ColorMode = 'altitude';
  /** 低缩放时把飞机聚合成带数字的圆点。 */
  private clusterEnabled = false;

  private raf: number | null = null;
  private lastDraw = 0;
  private hidden = false;
  private cw = 0;
  private ch = 0;

  constructor(app: MeowMap) {
    super();
    this.app = app;
  }

  onAdd(map: L.Map): this {
    this.lmap = map;
    const canvas = L.DomUtil.create('canvas', 'fra-aircraft-canvas leaflet-layer') as HTMLCanvasElement;
    canvas.style.position = 'absolute';
    const pane = map.getPane('overlayPane');
    if (!pane) return this;
    pane.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    map.on('moveend zoomend resize viewreset', this.refresh, this);
    map.on('zoomstart', this.hide, this);
    this.refresh();
    return this;
  }

  onRemove(map: L.Map): this {
    map.off('moveend zoomend resize viewreset', this.refresh, this);
    map.off('zoomstart', this.hide, this);
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
    this.lmap = null;
    return this;
  }

  /**
   * 收到一帧新数据：坐标有变化 → 重设锚点；没变 → 保持推算（同 FlightAware：
   * 动画由 地速×时间 驱动，与数据轮询解耦，因此位置不变的帧不会让飞机停住）。
   */
  setAircraft(list: Aircraft[]): void {
    const now = performance.now();

    const seen = new Set<string>();
    for (const ac of list) {
      seen.add(ac.icao24);
      const gsMs = typeof ac.groundSpeedKt === 'number' && ac.groundSpeedKt > 0 ? ac.groundSpeedKt * KT_TO_MS : 0;
      const hasTrack = typeof ac.trackDeg === 'number' && Number.isFinite(ac.trackDeg);
      const predictable = ac.predictable === true;
      const m = this.motion.get(ac.icao24);
      if (m) {
        // 用最短经度差把新上报点展开到锚点的连续经度上，
        // 使跨越日期变更线（179.9 → -179.8）时运动连续、不跳变。
        const d = (((ac.lon - m.repLon + 540) % 360) + 360) % 360 - 180;
        const newLon = m.repLon + d;
        const freshPing = haversineMeters(m.repLat, m.repLon, ac.lat, newLon) > NEW_PING_METERS;
        if (freshPing) {
          m.anchorLat = ac.lat;
          m.anchorLon = newLon;
          m.tAnchor = now;
        }
        m.repLat = ac.lat;
        m.repLon = newLon;
        if (gsMs > 0) m.gsMs = gsMs;
        if (hasTrack) m.trackDeg = ac.trackDeg as number;
        m.hasTrack = hasTrack || m.hasTrack;
        m.predictable = predictable;
      } else {
        this.motion.set(ac.icao24, {
          anchorLat: ac.lat,
          anchorLon: ac.lon,
          repLat: ac.lat,
          repLon: ac.lon,
          tAnchor: now,
          trackDeg: hasTrack ? (ac.trackDeg as number) : 0,
          hasTrack,
          gsMs,
          predictable,
        });
      }
    }
    for (const key of [...this.motion.keys()]) if (!seen.has(key)) this.motion.delete(key);

    this.data = list;
    this.hidden = false;
    this.lastDraw = 0;
    this.start();
  }

  setSelected(ids: Iterable<string>): void {
    this.selected = new Set(ids);
    this.refresh();
  }

  /** 设置高亮的飞机（与所选机场相关的航班）。 */
  setHighlighted(ids: Iterable<string>): void {
    this.highlighted = new Set(ids);
    this.refresh();
  }

  /** 只显示这些飞机（传 null 显示全部）。 */
  setVisibleIds(ids: Iterable<string> | null): void {
    this.visibleIds = ids ? new Set(ids) : null;
    this.refresh();
  }

  /** 设置被图例过滤隐藏的分类（categoryOf 的键），立即重绘。 */
  setHiddenCategories(cats: Set<string>): void {
    this.hiddenCats = new Set(cats);
    this.refresh();
  }

  /** 切换配色模式（高度 / 地速 / 升降率），立即重绘。 */
  setColorMode(mode: ColorMode): void {
    this.colorMode = mode;
    this.refresh();
  }

  /** 是否在低缩放时聚合。 */
  setCluster(enabled: boolean): void {
    this.clusterEnabled = enabled;
    this.refresh();
  }

  /** 当前显示位置对应的容器像素坐标（用于跟随标注定位）；无该机时返回 null。 */
  screenPointFor(icao24: string): L.Point | null {
    const map = this.lmap;
    if (!map) return null;
    const m = this.motion.get(icao24);
    if (!m) return null;
    const pos = this.positionOfMotion(m, performance.now());
    const local = this.app.toLocal(pos.lat, pos.lon);
    const base = map.latLngToContainerPoint([local.lat, local.lng]);
    return L.point(nearestCopyX(base.x, map.getSize().x / 2, worldPixelWidth(map)), base.y);
  }

  /** 当前显示位置（WGS-84）；无该机时返回 null。 */
  positionOf(icao24: string): { lat: number; lon: number } | null {
    const m = this.motion.get(icao24);
    if (!m) return null;
    return this.positionOfMotion(m, performance.now());
  }

  /** 命中测试：返回距离 containerPoint 阈值内最近的飞机。 */
  pick(containerPoint: L.Point, threshold = 17): Aircraft | null {
    const map = this.lmap;
    if (!map) return null;
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    const worldPx = worldPixelWidth(map);
    let best: Aircraft | null = null;
    let bestD = threshold;
    const now = performance.now();
    for (const ac of this.data) {
      if (this.hiddenCats.has(categoryOf(ac, this.colorMode))) continue;
      if (this.visibleIds && !this.visibleIds.has(ac.icao24)) continue;
      const pos = this.positionFor(ac.icao24, now, ac);
      const local = this.app.toLocal(pos.lat, pos.lon);
      const p = map.latLngToLayerPoint([local.lat, local.lng]).subtract(topLeft);
      const x = nearestCopyX(p.x, containerPoint.x, worldPx);
      const d = Math.hypot(x - containerPoint.x, p.y - containerPoint.y);
      if (d < bestD) {
        bestD = d;
        best = ac;
      }
    }
    return best;
  }

  /** 立即重绘（也作为 Leaflet 的 moveend/zoomend 处理器）。 */
  refresh = (): void => {
    this.hidden = false;
    this.lastDraw = performance.now();
    this.draw(this.lastDraw);
  };

  private hide = (): void => {
    this.hidden = true;
    if (this.canvas) this.canvas.style.display = 'none';
  };

  private start(): void {
    if (this.raf === null) this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (): void => {
    this.raf = null;
    const now = performance.now();
    if (!this.hidden && now - this.lastDraw >= 33) {
      this.draw(now);
      this.lastDraw = now;
    }
    if (this.data.length > 0) this.raf = requestAnimationFrame(this.tick);
  };

  /**
   * 某机在 `now` 的显示位置：以锚点为起点，按 地速 × 距锚定时间 沿航迹角位位推算
   * （上限 MAX_EXTRAPOLATE_SEC），完全对齐 FlightAware 的 _animateCallback；
   * 不允许推算 / 缺地速航向时停在锚点等下一帧。
   */
  private positionOfMotion(m: Motion, now: number): { lat: number; lon: number } {
    if (m.predictable && m.gsMs > 0 && m.hasTrack) {
      const dt = Math.min((now - m.tAnchor) / 1000, MAX_EXTRAPOLATE_SEC);
      return projectForward(m.anchorLat, m.anchorLon, m.trackDeg, m.gsMs * dt);
    }
    return { lat: m.anchorLat, lon: m.anchorLon };
  }

  private positionFor(icao24: string, now: number, fallback: Aircraft): { lat: number; lon: number } {
    const m = this.motion.get(icao24);
    if (!m) return { lat: fallback.lat, lon: fallback.lon };
    return this.positionOfMotion(m, now);
  }

  private trackFor(icao24: string, fallbackTrack: number): number {
    const m = this.motion.get(icao24);
    return m ? m.trackDeg : fallbackTrack;
  }

  private draw(now: number): void {
    const map = this.lmap;
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!map || !canvas || !ctx) return;

    const size = map.getSize();
    if (this.cw !== size.x || this.ch !== size.y) {
      this.cw = size.x;
      this.ch = size.y;
      canvas.width = Math.max(1, Math.floor(size.x * this.dpr));
      canvas.height = Math.max(1, Math.floor(size.y * this.dpr));
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
    }
    canvas.style.display = '';

    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(canvas, topLeft);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);

    const zoom = map.getZoom();
    const showLabels = zoom >= 9 && this.data.length <= 500;
    const worldPx = worldPixelWidth(map);
    const centerX = size.x / 2;

    // 低缩放 + 开启聚合：画带数量的聚合点
    if (this.clusterEnabled && zoom < 7) {
      this.drawClusters(ctx, now, size, topLeft, worldPx, centerX);
      return;
    }

    for (const ac of this.data) {
      if (this.hiddenCats.has(categoryOf(ac, this.colorMode))) continue;
      if (this.visibleIds && !this.visibleIds.has(ac.icao24)) continue;
      const pos = this.positionFor(ac.icao24, now, ac);
      const local = this.app.toLocal(pos.lat, pos.lon);
      const base = map.latLngToLayerPoint([local.lat, local.lng]).subtract(topLeft);
      if (base.y < -20 || base.y > size.y + 20) continue;
      const track = this.trackFor(ac.icao24, ac.trackDeg ?? 0);
      // 横向世界副本：在所有可见副本里各画一份，跨日期变更线拖动时都连续可见
      const kLo = Math.ceil((-20 - base.x) / worldPx);
      const kHi = Math.floor((size.x + 20 - base.x) / worldPx);
      const kLabel = Math.min(kHi, Math.max(kLo, Math.round((centerX - base.x) / worldPx)));
      for (let k = kLo; k <= kHi; k++) {
        this.drawOne(ctx, base.x + k * worldPx, base.y, ac, track, showLabels && k === kLabel);
      }
    }
  }

  /** 低缩放聚合：按屏幕网格统计，画圆点 + 数量，颜色取平均高度。 */
  private drawClusters(
    ctx: CanvasRenderingContext2D,
    now: number,
    size: L.Point,
    topLeft: L.Point,
    worldPx: number,
    centerX: number,
  ): void {
    const map = this.lmap!;
    const CELL = 46;
    interface Bucket {
      sx: number;
      sy: number;
      n: number;
      alt: number;
      altN: number;
      single: Aircraft | null;
      sTrack: number;
    }
    const buckets = new Map<string, Bucket>();
    for (const ac of this.data) {
      if (this.hiddenCats.has(categoryOf(ac, this.colorMode))) continue;
      if (this.visibleIds && !this.visibleIds.has(ac.icao24)) continue;
      const pos = this.positionFor(ac.icao24, now, ac);
      const local = this.app.toLocal(pos.lat, pos.lon);
      const raw = map.latLngToLayerPoint([local.lat, local.lng]).subtract(topLeft);
      const x = nearestCopyX(raw.x, centerX, worldPx);
      if (x < -CELL || x > size.x + CELL || raw.y < -CELL || raw.y > size.y + CELL) continue;
      const key = `${Math.floor(x / CELL)}:${Math.floor(raw.y / CELL)}`;
      let b = buckets.get(key);
      if (!b) {
        b = { sx: 0, sy: 0, n: 0, alt: 0, altN: 0, single: ac, sTrack: this.trackFor(ac.icao24, ac.trackDeg ?? 0) };
        buckets.set(key, b);
      }
      b.sx += x;
      b.sy += raw.y;
      b.n += 1;
      if (ac.altFt !== null) {
        b.alt += ac.altFt;
        b.altN += 1;
      }
      b.single = ac; // 记录任意一架，n===1 时按正常符号画
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of buckets.values()) {
      const cx = b.sx / b.n;
      const cy = b.sy / b.n;
      if (b.n === 1 && b.single) {
        this.drawOne(ctx, cx, cy, b.single, b.sTrack, false);
        continue;
      }
      const avgAlt = b.altN ? b.alt / b.altN : null;
      const color = colorForAltitude(avgAlt);
      const r = Math.min(20, 7 + Math.sqrt(b.n) * 2.6);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(13,17,23,0.35)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0b0f14';
      ctx.font = `700 ${Math.min(13, 9 + r * 0.2)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.fillText(String(b.n), cx, cy + 0.5);
    }
  }

  private drawOne(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    ac: Aircraft,
    track: number,
    labels: boolean,
  ): void {
    const color = colorFor(ac, this.colorMode);
    const isSel = this.selected.has(ac.icao24);
    const isHi = this.highlighted.has(ac.icao24);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((track * Math.PI) / 180);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 始终按机型画符号（含地面），颜色由高度/地面决定
    if (ac.kind === 'helicopter') {
      this.drawHelicopter(ctx, color);
    } else {
      this.drawFixedWing(ctx, color, ac.kind);
    }

    if (isHi) {
      // 与所选机场相关的飞机：琥珀色高亮环
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.95)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    if (isSel) {
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();

    if (labels && (ac.callsign || ac.registration) && (ac.altFt ?? 0) > 1000) {
      const base = ac.callsign || ac.registration || '';
      const text = ac.typeCode ? `${base} · ${ac.typeCode}` : base;
      const tx = x + 12;
      const ty = y - 10;
      ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(8,10,14,0.9)';
      ctx.strokeText(text, tx, ty);
      ctx.fillStyle = '#f4f8fc';
      ctx.fillText(text, tx, ty);
    }
  }

  /** 固定翼：按类别调整尺寸/后掠（重型/轻型/滑翔机不同）。白 halo + 深色边缘，深浅底图都清晰。 */
  private drawFixedWing(ctx: CanvasRenderingContext2D, color: string, kind: Aircraft['kind']): void {
    const heavy = kind === 'heavy';
    const light = kind === 'piston' || kind === 'turboprop';
    const glider = kind === 'glider';
    const s = ICON_SCALE;
    const len = (heavy ? 11 : light ? 7 : 9) * s; // 半长
    const span = (glider ? 11 : heavy ? 10 : light ? 6 : 8) * s; // 半翼展
    const sweep = (glider ? 0 : heavy ? 3 : 2.4) * s;

    ctx.beginPath();
    // 机身
    ctx.moveTo(0, -len);
    ctx.lineTo(1.3 * s, -len * 0.3);
    ctx.lineTo(1.3 * s, len * 0.55);
    ctx.lineTo(0.6 * s, len);
    ctx.lineTo(-0.6 * s, len);
    ctx.lineTo(-1.3 * s, len * 0.55);
    ctx.lineTo(-1.3 * s, -len * 0.3);
    ctx.closePath();
    // 主翼
    ctx.moveTo(0, -len * 0.1);
    ctx.lineTo(-span, len * 0.2 - sweep);
    ctx.lineTo(-span, len * 0.2 - sweep + 1.3 * s);
    ctx.lineTo(-0.9 * s, len * 0.28);
    ctx.lineTo(0.9 * s, len * 0.28);
    ctx.lineTo(span, len * 0.2 - sweep + 1.3 * s);
    ctx.lineTo(span, len * 0.2 - sweep);
    ctx.closePath();
    // 平尾
    ctx.moveTo(0, len * 0.72);
    ctx.lineTo(-span * 0.34, len * 0.92);
    ctx.lineTo(-span * 0.34, len * 0.92 + 1 * s);
    ctx.lineTo(0, len * 0.85);
    ctx.lineTo(span * 0.34, len * 0.92 + 1 * s);
    ctx.lineTo(span * 0.34, len * 0.92);
    ctx.closePath();

    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = HALO_WIDTH;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,12,16,0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** 直升机：旋翼 + 机身 + 尾梁（白 halo 提升可见度）。 */
  private drawHelicopter(ctx: CanvasRenderingContext2D, color: string): void {
    const s = ICON_SCALE;
    const R = 9 * s;

    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.moveTo(-R, 0);
    ctx.lineTo(R, 0);
    ctx.moveTo(0, -R);
    ctx.lineTo(0, R);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = HALO_WIDTH;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(0, 0, 2.1 * s, 4.4 * s, 0, 0, Math.PI * 2);
    ctx.moveTo(-0.6 * s, 3.2 * s);
    ctx.lineTo(-0.6 * s, 9.5 * s);
    ctx.lineTo(0.6 * s, 9.5 * s);
    ctx.lineTo(0.6 * s, 3.2 * s);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = HALO_WIDTH;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,12,16,0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
