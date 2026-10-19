import L from 'leaflet';
import type { IfrFix } from '@flightradar/shared';
import type { MeowMap } from 'meow-tile-kit';
import { fetchIfrFixesInBBox } from '../api';
import { copyOffsets } from '../wrap';

/**
 * IFR 航路点（FAA CIFP，公有领域）。按视野 bbox 拉取，Canvas 渲染。覆盖美国。
 * 可开关。
 */
export class WaypointLayer {
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
    if (this.map.getZoom() < 5) {
      this.group.clearLayers();
      this.lastBbox = '';
      return;
    }
    const id = ++this.reqId;
    let fixes: IfrFix[];
    try {
      fixes = await fetchIfrFixesInBBox(bbox);
    } catch {
      return;
    }
    if (id !== this.reqId) return;
    this.lastBbox = bbox;
    this.group.clearLayers();
    for (const off of copyOffsets(this.map)) {
      for (const f of fixes) this.group.addLayer(this.marker(f, off));
    }
  }

  private marker(f: IfrFix, lonOffset: number): L.Layer {
    const p = this.app.toLocal(f.lat, f.lon + lonOffset);
    const marker = L.circleMarker([p.lat, p.lng], {
      renderer: this.renderer,
      radius: 2,
      color: '#79c0ff',
      weight: 1,
      fillColor: '#0d1117',
      fillOpacity: 0.4,
    });
    marker.bindTooltip(`${f.ident}（航路点${f.kind === 'terminal' ? ' · 终端区' : ''}）`, { direction: 'top' });
    return marker;
  }
}
