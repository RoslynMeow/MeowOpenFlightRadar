import L from 'leaflet';
import type { Feature, FeatureCollection } from 'geojson';
import type { MeowMap } from 'meow-tile-kit';
import { fetchRunwaysInBBox } from '../api';
import { copyOffsets, nearestCopyX, worldPixelWidth } from '../wrap';

/** 点到线段的最短距离（容器像素）。 */
function pointSegDist(p: L.Point, a: L.Point, b: L.Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 命中点击点附近最近的跑道，返回其属性（无则 null）。 */
export function pickRunway(
  features: Feature[],
  app: MeowMap,
  map: L.Map,
  cp: L.Point,
  threshold = 7,
): Record<string, unknown> | null {
  const worldPx = worldPixelWidth(map);
  let best: Record<string, unknown> | null = null;
  let bestD = threshold;
  for (const f of features) {
    const geom = f.geometry;
    if (!geom || geom.type !== 'LineString') continue;
    const coords = geom.coordinates as number[][];
    if (coords.length < 2) continue;
    const pts: L.Point[] = [];
    for (const c of coords) {
      const p = app.toLocal(c[1], c[0]);
      const q = map.latLngToContainerPoint([p.lat, p.lng]);
      pts.push(L.point(nearestCopyX(q.x, cp.x, worldPx), q.y));
    }
    for (let i = 1; i < pts.length; i++) {
      const d = pointSegDist(cp, pts[i - 1], pts[i]);
      if (d < bestD) {
        bestD = d;
        best = (f.properties ?? {}) as Record<string, unknown>;
      }
    }
  }
  return best;
}

/** 单个机场的跑道图层（只画线，选中信息由点击标注负责）。 */
export function createRunwayLayer(app: MeowMap, geojson: FeatureCollection, lonOffset = 0): L.GeoJSON {
  return L.geoJSON(geojson, {
    coordsToLatLng: (coords: number[]) => {
      const p = app.toLocal(coords[1], coords[0] + lonOffset);
      return L.latLng(p.lat, p.lng);
    },
    style: (feature) => {
      const props = (feature?.properties ?? {}) as { closed?: boolean; widthFt?: number | null };
      const weight = Math.max(2, Math.min(7, (props.widthFt ?? 150) / 45));
      return { color: props.closed ? '#6e7681' : '#ff5d8f', weight, opacity: 0.95, lineCap: 'butt' };
    },
  });
}

/** 视野内的跑道（常驻，缩放到一定级别才拉取，避免低缩放画太多）。 */
export class RunwayOverlay {
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

  /** 命中视野内最近的跑道（属性）；无则 null。 */
  pick(cp: L.Point, threshold = 7): Record<string, unknown> | null {
    return pickRunway(this.features, this.app, this.map, cp, threshold);
  }

  async refresh(bbox: string): Promise<void> {
    if (bbox === this.lastBbox) return;
    if (this.map.getZoom() < 8) {
      for (const l of this.layers) this.group.removeLayer(l);
      this.layers = [];
      this.features = [];
      this.lastBbox = '';
      return;
    }
    const id = ++this.reqId;
    let data: FeatureCollection;
    try {
      data = await fetchRunwaysInBBox(bbox);
    } catch {
      return;
    }
    if (id !== this.reqId) return;
    this.lastBbox = bbox;
    this.features = (data.features ?? []) as Feature[];

    for (const l of this.layers) this.group.removeLayer(l);
    this.layers = [];
    // 每个世界副本各铺一份，跨日期变更线拖动时跑道同样连续
    for (const off of copyOffsets(this.map)) {
      const layer = L.geoJSON(data, {
        renderer: this.renderer,
        coordsToLatLng: (coords: number[]) => {
          const p = this.app.toLocal(coords[1], coords[0] + off);
          return L.latLng(p.lat, p.lng);
        },
        style: (feature) => {
          const props = (feature?.properties ?? {}) as { closed?: boolean; widthFt?: number | null };
          const weight = Math.max(2, Math.min(7, (props.widthFt ?? 150) / 45));
          return { color: props.closed ? '#6e7681' : '#ff5d8f', weight, opacity: 0.95, lineCap: 'butt' };
        },
      } as L.GeoJSONOptions);
      layer.addTo(this.group);
      this.layers.push(layer);
    }
  }
}
