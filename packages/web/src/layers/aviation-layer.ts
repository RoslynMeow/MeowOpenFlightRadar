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

function isNdb(n: Navaid): boolean {
  return n.type.startsWith('NDB');
}

/**
 * 全球航空叠加层：机场 + 导航台（数据来自 OurAirports，公有领域）。
 * 用一块 Canvas 渲染，避免大量 SVG 节点；按视野 bbox 拉取。
 * 机场 / 导航台(VOR/DME 等) / NDB 三个子层可分别开关。
 */
export class AviationLayer {
  private readonly app: MeowMap;
  private readonly map: L.Map;
  private readonly renderer: L.Canvas;
  private readonly group: L.LayerGroup;
  private showAirports = true;
  private showNavaids = true;
  private showNdb = true;
  private reqId = 0;
  private lastBbox = '';
  private airportsFetched = false;
  private navaidsFetched = false;
  private airports: AirportSummary[] = [];
  private navaids: Navaid[] = [];

  constructor(app: MeowMap) {
    this.app = app;
    this.map = app.map as L.Map;
    this.renderer = L.canvas({ padding: 0.5 });
    this.group = L.layerGroup().addTo(this.map);
  }

  /** 机场子层开关。 */
  setAirportsVisible(v: boolean): void {
    if (v === this.showAirports) return;
    this.showAirports = v;
    this.syncGroup();
    this.render();
  }

  /** 导航台子层开关（VOR/DME/TACAN 等）。 */
  setNavaidsVisible(v: boolean): void {
    if (v === this.showNavaids) return;
    this.showNavaids = v;
    this.syncGroup();
    this.render();
  }

  /** NDB 子开关（隶属导航台层）。 */
  setNdbVisible(v: boolean): void {
    if (v === this.showNdb) return;
    this.showNdb = v;
    this.render();
  }

  /** 整体开关（机场 + 导航台）。 */
  setVisible(v: boolean): void {
    this.setAirportsVisible(v);
    this.setNavaidsVisible(v);
  }

  isVisible(): boolean {
    return this.showAirports || this.showNavaids;
  }

  private syncGroup(): void {
    if (this.showAirports || this.showNavaids) this.group.addTo(this.map);
    else this.map.removeLayer(this.group);
  }

  /** 图源切换后坐标系变化，丢弃缓存以便下次重投影。 */
  invalidate(): void {
    this.lastBbox = '';
    this.airportsFetched = false;
    this.navaidsFetched = false;
  }

  /** 命中测试：返回容器点附近最近机场的 ident（用于统一点击处理）。 */
  pick(cp: L.Point, threshold = 16): string | null {
    if (!this.showAirports) return null;
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
    if (!this.showNavaids) return null;
    const worldPx = worldPixelWidth(this.map);
    let best: Navaid | null = null;
    let bestD = threshold;
    for (const n of this.navaids) {
      if (!this.showNdb && isNdb(n)) continue;
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

  /** 按 bbox 拉取并渲染；并发请求只保留最新一次。已启用的子层数据齐全时只重绘。 */
  async refresh(bbox: string): Promise<void> {
    const needAirports = this.showAirports;
    const needNavaids = this.showNavaids;
    if (!needAirports && !needNavaids) {
      this.group.clearLayers();
      this.lastBbox = '';
      return;
    }
    const upToDate =
      bbox === this.lastBbox &&
      (!needAirports || this.airportsFetched) &&
      (!needNavaids || this.navaidsFetched);
    if (upToDate) {
      this.render();
      return;
    }
    const id = ++this.reqId;
    let airports: AirportSummary[] = this.airports;
    let navaids: Navaid[] = this.navaids;
    try {
      [airports, navaids] = await Promise.all([
        needAirports ? fetchAirportsInBBox(bbox) : Promise.resolve(this.airports),
        needNavaids ? fetchNavaidsInBBox(bbox) : Promise.resolve(this.navaids),
      ]);
    } catch {
      return;
    }
    if (id !== this.reqId) return;
    this.lastBbox = bbox;
    this.airports = airports;
    this.airportsFetched = needAirports;
    this.navaids = navaids;
    this.navaidsFetched = needNavaids;
    this.render();
  }

  /** 依据当前开关重绘（每个世界副本各铺一份，跨日期变更线连续）。 */
  private render(): void {
    this.group.clearLayers();
    for (const off of copyOffsets(this.map)) {
      if (this.showAirports) for (const a of this.airports) this.group.addLayer(this.airportMarker(a, off));
      if (this.showNavaids) {
        for (const n of this.navaids) {
          if (!this.showNdb && isNdb(n)) continue;
          this.group.addLayer(this.navaidMarker(n, off));
        }
      }
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
    const ndb = isNdb(n);
    const p = this.app.toLocal(n.lat, n.lon + lonOffset);
    const marker = L.circleMarker([p.lat, p.lng], {
      renderer: this.renderer,
      radius: ndb ? 3 : 4.5,
      color: ndb ? '#f0a020' : '#c792ea',
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
