import L from 'leaflet';
import type { Feature, FeatureCollection } from 'geojson';
import type { MeowMap } from 'meow-tile-kit';
import { fetchFir } from '../api';
import { pointInGeometry } from '../geo';
import { copyOffsets } from '../wrap';

/**
 * FIR/UIR 情报区边界（VATSIM / VATSpy，CC-BY-SA-4.0）。
 * 虚线轮廓 + 主情报区名称标签（子扇区仅悬停显示）。点击命中由外部统一点击处理通过 pickLatLng 完成。
 */
export class FirLayer {
  private readonly app: MeowMap;
  private readonly map: L.Map;
  private readonly renderer: L.Canvas;
  private readonly group: L.LayerGroup;
  private layers: L.GeoJSON[] = [];
  private labels: L.LayerGroup | null = null;
  private features: Feature[] = [];
  private reqId = 0;
  private lastBbox = '';

  constructor(app: MeowMap) {
    this.app = app;
    this.map = app.map as L.Map;
    this.renderer = L.canvas({ padding: 0.5 });
    this.group = L.layerGroup().addTo(this.map);
  }

  invalidate(): void {
    this.lastBbox = '';
  }

  /** 命中测试：返回包含该 WGS-84 点的情报区属性（子扇区优先）。 */
  pickLatLng(lat: number, lon: number): Record<string, unknown> | null {
    let best: Record<string, unknown> | null = null;
    let bestArea = Infinity;
    for (const f of this.features) {
      if (!f.geometry) continue;
      if (!pointInGeometry(lon, lat, f.geometry)) continue;
      const area = 'coordinates' in f.geometry ? bboxArea(f.geometry.coordinates as unknown) : Infinity;
      if (area < bestArea) {
        bestArea = area;
        best = (f.properties ?? {}) as Record<string, unknown>;
      }
    }
    return best;
  }

  async refresh(bbox: string): Promise<void> {
    if (bbox === this.lastBbox) return;
    const id = ++this.reqId;
    let data: FeatureCollection;
    try {
      data = await fetchFir(bbox);
    } catch {
      return;
    }
    if (id !== this.reqId) return;
    this.lastBbox = bbox;
    this.features = data.features ?? [];

    for (const l of this.layers) this.group.removeLayer(l);
    this.layers = [];
    if (this.labels) this.group.removeLayer(this.labels);

    // 每个世界副本各铺一份，跨日期变更线拖动时边界与标签同样连续
    for (const off of copyOffsets(this.map)) {
      const layer = L.geoJSON(data, {
        renderer: this.renderer,
        coordsToLatLng: (coords: number[]) => {
          const p = this.app.toLocal(coords[1], coords[0] + off);
          return L.latLng(p.lat, p.lng);
        },
        style: { color: '#f0c674', weight: 1, opacity: 0.7, dashArray: '4 4', fill: false },
        onEachFeature: (f, l) => {
          const p = (f.properties ?? {}) as Record<string, unknown>;
          const extra = [p.region, p.division].filter(Boolean).join(' / ');
          l.bindTooltip(`${p.id ?? ''}${extra ? ` · ${extra}` : ''}`, { sticky: true });
        },
      } as L.GeoJSONOptions);
      layer.addTo(this.group);
      this.layers.push(layer);
    }

    // 主情报区（id 不含 '-'）加名称标签
    this.labels = L.layerGroup();
    if (this.map.getZoom() >= 4) {
      for (const off of copyOffsets(this.map)) {
        for (const f of data.features) {
          const p = (f.properties ?? {}) as Record<string, unknown>;
          const fid = String(p.id ?? '');
          if (!fid || fid.includes('-')) continue;
          const lat = Number(p.label_lat);
          const lon = Number(p.label_lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          const q = this.app.toLocal(lat, lon + off);
          L.marker([q.lat, q.lng], {
            interactive: false,
            icon: L.divIcon({ className: 'fra-fir-label', html: fid, iconSize: [0, 0] }),
          }).addTo(this.labels);
        }
      }
      this.labels.addTo(this.group);
    }
  }
}

/** 粗略包围盒面积（用于选最小匹配区域）。 */
function bboxArea(coords: unknown): number {
  let minLat = 90;
  let minLon = 180;
  let maxLat = -90;
  let maxLon = -180;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const lon = c[0] as number;
      const lat = c[1] as number;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    } else if (Array.isArray(c)) {
      c.forEach(walk);
    }
  };
  walk(coords);
  return Math.max(0, maxLat - minLat) * Math.max(0, maxLon - minLon);
}
