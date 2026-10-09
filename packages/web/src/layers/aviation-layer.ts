import L from 'leaflet';
import type { Navaid } from '@flightradar/shared';
import type { MeowMap } from 'meow-tile-kit';
import { fetchAirportsInBBox, fetchNavaidsInBBox, type AirportSummary } from '../api';
import { copyOffsets, nearestCopyX, worldPixelWidth } from '../wrap';

export function navaidLabel(n: Navaid): string {
  if (!n.freqKhz) return '—';
  if (n.type.startsWith('NDB')) return `${n.freqKhz} kHz`;
  return `${(n.freqKhz / 1000).toFixed(2)} MHz`;
}

/**
 * 全球航空叠加层：机场 + 导航台（数据来自 OurAirports，公有领域）。
 * 用一块 Canvas 渲染，避免大量 SVG 节点；按视野 bbox 拉取。
 */
export class AviationLayer {
  private readonly app: MeowMap;
  private readonly map: L.Map;
  private readonly renderer: L.Canvas;
  private readonly group: L.LayerGroup;
  private enabled = true;
  private reqId = 0;
  private lastBbox = '';
  private airports: AirportSummary[] = [];
  private navaids: Navaid[] = [];

  constructor(app: MeowMap) {
    this.app = app;
    this.map = app.map as L.Map;
    this.renderer = L.canvas({ padding: 0.5 });
    this.group = L.layerGroup().addTo(this.map);
  }

  setVisible(v: boolean): void {
    this.enabled = v;
    if (v) this.group.addTo(this.map);
    else this.map.removeLayer(this.group);
  }

  isVisible(): boolean {
    return this.enabled;
  }

  /** 图源切换后坐标系变化，丢弃缓存以便下次重投影。 */
  invalidate(): void {
    this.lastBbox = '';
  }

  /** 命中测试：返回容器点附近最近机场的 ident（用于统一点击处理）。 */
  pick(cp: L.Point, threshold = 16): string | null {
    const worldPx = worldPixelWidth(this.map);
    let best: string | null = null;
    let bestD = threshold;
    for (const a of this.airports) {
      const p = this.app.toLocal(a.lat, a.lon);
      const c = this.map.latLngToContainerPoint([p.lat, p.lng]);
      const x = nearestCopyX(c.x, cp.x, worldPx);
      const d = Math.hypot(x - cp.x, c.y - cp.y);
      if (d < bestD) {
        bestD = d;
        best = a.ident;
      }
    }
    return best;
  }

  /** 命中测试：返回容器点附近最近导航台（VOR/DME/NDB 等）。 */
  pickNavaid(cp: L.Point, threshold = 13): Navaid | null {
    const worldPx = worldPixelWidth(this.map);
    let best: Navaid | null = null;
    let bestD = threshold;
    for (const n of this.navaids) {
      const p = this.app.toLocal(n.lat, n.lon);
      const c = this.map.latLngToContainerPoint([p.lat, p.lng]);
      const x = nearestCopyX(c.x, cp.x, worldPx);
      const d = Math.hypot(x - cp.x, c.y - cp.y);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  /** 按 bbox 拉取并渲染；并发请求只保留最新一次。 */
  async refresh(bbox: string): Promise<void> {
    if (!this.enabled || bbox === this.lastBbox) return;
    const id = ++this.reqId;
    let airports: AirportSummary[] = [];
    let navaids: Navaid[] = [];
    try {
      [airports, navaids] = await Promise.all([fetchAirportsInBBox(bbox), fetchNavaidsInBBox(bbox)]);
    } catch {
      return;
    }
    if (id !== this.reqId) return;
    this.lastBbox = bbox;
    this.airports = airports;
    this.navaids = navaids;
    this.group.clearLayers();
    // 每个世界副本各铺一份，跨日期变更线拖动时叠加层同样连续可见
    for (const off of copyOffsets(this.map)) {
      for (const n of navaids) this.group.addLayer(this.navaidMarker(n, off));
      for (const a of airports) this.group.addLayer(this.airportMarker(a, off));
    }
  }

  private airportMarker(a: AirportSummary, lonOffset: number): L.Layer {
    const large = a.type === 'large_airport';
    const medium = a.type === 'medium_airport';
    const color = large ? '#4fc3f7' : medium ? '#7ee787' : '#9aa7b2';
    const p = this.app.toLocal(a.lat, a.lon + lonOffset);
    const marker = L.circleMarker([p.lat, p.lng], {
      renderer: this.renderer,
      radius: large ? 6.5 : medium ? 5 : 4,
      color: '#ffffff',
      weight: 1.6,
      fillColor: color,
      fillOpacity: 1,
    });
    const label = a.iata || a.ident;
    marker.bindTooltip(`${label} · ${a.name}（点击查看航班）`, { direction: 'top', sticky: true });
    marker.on('mouseover', () => {
      this.map.getContainer().style.cursor = 'pointer';
    });
    marker.on('mouseout', () => {
      this.map.getContainer().style.cursor = '';
    });
    return marker;
  }

  private navaidMarker(n: Navaid, lonOffset: number): L.Layer {
    const isNdb = n.type.startsWith('NDB');
    const p = this.app.toLocal(n.lat, n.lon + lonOffset);
    const marker = L.circleMarker([p.lat, p.lng], {
      renderer: this.renderer,
      radius: isNdb ? 3 : 4.5,
      color: isNdb ? '#f0a020' : '#c792ea',
      weight: 1,
      fillColor: '#0d1117',
      fillOpacity: 0.55,
    });
    marker.bindTooltip(`${n.ident} · ${navaidLabel(n)} · ${n.type}（点击查看）`, { direction: 'top' });
    marker.on('mouseover', () => {
      this.map.getContainer().style.cursor = 'pointer';
    });
    marker.on('mouseout', () => {
      this.map.getContainer().style.cursor = '';
    });
    return marker;
  }
}
