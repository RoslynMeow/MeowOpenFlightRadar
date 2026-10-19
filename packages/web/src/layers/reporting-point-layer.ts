import L from 'leaflet';
import type { ReportingPoint } from '@flightradar/shared';
import type { MeowMap } from 'meow-tile-kit';
import { fetchReportingPointsInBBox } from '../api';
import { copyOffsets } from '../wrap';

/**
 * 全球报告点 / 目视报告点（VRP，openAIP，CC BY-NC 4.0）。按视野 bbox 拉取，Canvas 渲染。
 * 覆盖 57 个国家（不含美/中），是 VFR 报告点而非 IFR 航路点。可开关。
 */
export class ReportingPointLayer {
  private readonly app: MeowMap;
  private readonly map: L.Map;
  private readonly renderer: L.Canvas;
  private readonly group: L.LayerGroup;
  private reqId = 0;
  private lastBbox = '';
  private enabled = true;

  constructor(app: MeowMap) {
    this.app = app;
    this.map = app.map as L.Map;
    this.renderer = L.canvas({ padding: 0.5 });
    this.group = L.layerGroup().addTo(this.map);
  }

  /** 显示/隐藏报告点层（关闭时跳过网络请求并清空图层）。 */
  setVisible(v: boolean): void {
    if (v === this.enabled) return;
    this.enabled = v;
    if (v) {
      this.group.addTo(this.map);
      this.lastBbox = '';
    } else {
      this.map.removeLayer(this.group);
      this.group.clearLayers();
    }
  }

  isVisible(): boolean {
    return this.enabled;
  }

  invalidate(): void {
    this.lastBbox = '';
  }

  async refresh(bbox: string): Promise<void> {
    if (!this.enabled || bbox === this.lastBbox) return;
    if (this.map.getZoom() < 4) {
      this.group.clearLayers();
      this.lastBbox = '';
      return;
    }
    const id = ++this.reqId;
    let points: ReportingPoint[];
    try {
      points = await fetchReportingPointsInBBox(bbox);
    } catch {
      return;
    }
    if (id !== this.reqId) return;
    this.lastBbox = bbox;
    this.group.clearLayers();
    for (const off of copyOffsets(this.map)) {
      for (const p of points) this.group.addLayer(this.marker(p, off));
    }
  }

  private marker(p: ReportingPoint, lonOffset: number): L.Layer {
    const q = this.app.toLocal(p.lat, p.lon + lonOffset);
    const marker = L.circleMarker([q.lat, q.lng], {
      renderer: this.renderer,
      radius: p.compulsory ? 3.2 : 2.4,
      color: '#5eead4',
      weight: 1,
      fillColor: '#0d1117',
      fillOpacity: 0.5,
    });
    const bits = [p.name || '—', p.compulsory ? '强制' : '', p.elevationFt != null ? `${p.elevationFt} ft` : '', p.country]
      .filter(Boolean)
      .join(' · ');
    marker.bindTooltip(`${bits}（报告点）`, { direction: 'top' });
    return marker;
  }
}
