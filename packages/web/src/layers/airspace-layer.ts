import L from 'leaflet';
import type { Feature, FeatureCollection } from 'geojson';
import type { MeowMap } from 'meow-tile-kit';
import { fetchAirspace } from '../api';
import { pointInGeometry } from '../geo';
import { copyOffsets } from '../wrap';

/** openAIP 空域类型分组配色（type: 1 限制 / 2 危险 / 3 禁飞 / 4 CTR / 7 TMA / 8 CTA …）。 */
function styleFor(props: Record<string, unknown>): L.PathOptions {
  const type = Number(props.type);
  if (type === 1 || type === 2 || type === 3) {
    return { color: '#ff6b6b', weight: 1, opacity: 0.6, fillColor: '#ff6b6b', fillOpacity: 0.06 };
  }
  if (type === 4 || type === 7 || type === 8 || type === 16) {
    return { color: '#4fc3f7', weight: 1, opacity: 0.5, fillColor: '#4fc3f7', fillOpacity: 0.04 };
  }
  return { color: '#8b949e', weight: 1, opacity: 0.4, fillColor: '#8b949e', fillOpacity: 0.03 };
}

function fmtLimit(x: unknown): string {
  const o = x as { v?: number | null; unit?: number | null } | null;
  if (!o || o.v == null) return '?';
  const unit = o.unit === 0 ? 'ft' : o.unit === 1 ? 'm' : '';
  return `${o.v}${unit}`;
}

/**
 * 全球空域叠加（openAIP，CC BY-NC 4.0）。按视野 bbox 拉取，Canvas 渲染，常驻显示。
 * 点击命中由外部统一点击处理通过 pickLatLng 完成（保证飞机/机场优先）。
 * 数据来源须署名 https://www.openaip.net
 */
export class AirspaceLayer {
  private readonly app: MeowMap;
  private readonly map: L.Map;
  private readonly renderer: L.Canvas;
  private readonly group: L.LayerGroup;
  private layers: L.GeoJSON[] = [];
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

  /** 命中测试：返回包含该 WGS-84 点的空域属性（优先小面积，避免被大区域挡住）。 */
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
      data = await fetchAirspace(bbox);
    } catch {
      return;
    }
    if (id !== this.reqId) return;
    this.lastBbox = bbox;
    this.features = data.features ?? [];

    for (const l of this.layers) this.group.removeLayer(l);
    this.layers = [];
    // 每个世界副本各铺一份，跨日期变更线拖动时空域同样连续
    for (const off of copyOffsets(this.map)) {
      const layer = L.geoJSON(data, {
        renderer: this.renderer,
        coordsToLatLng: (c: number[]) => {
          const p = this.app.toLocal(c[1], c[0] + off);
          return L.latLng(p.lat, p.lng);
        },
        style: (f) => styleFor((f?.properties ?? {}) as Record<string, unknown>),
        onEachFeature: (f, l) => {
          const p = (f.properties ?? {}) as Record<string, unknown>;
          if (!p.name) return;
          const cls =
            p.icaoClass != null && Number(p.icaoClass) <= 7
              ? ` · Class ${String.fromCharCode(65 + Number(p.icaoClass))}`
              : '';
          l.bindTooltip(`${p.name}${cls}<br>${fmtLimit(p.lower)} – ${fmtLimit(p.upper)}`, { sticky: true });
        },
      } as L.GeoJSONOptions);
      layer.addTo(this.group);
      this.layers.push(layer);
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
