import L from 'leaflet';
import type { FeatureCollection } from 'geojson';
import type { MeowMap } from 'meow-tile-kit';
import { copyOffsets } from '../wrap';

/** SID 折线配色。 */
const SID_COLOR = '#ff9e64';
/** STAR 折线配色。 */
const STAR_COLOR = '#d2a8ff';

/**
 * 进离场程序（SID/STAR）叠加：仅渲染当前选中机场的程序，按需加载。
 * SID / STAR 可分别开关。
 */
export class ProcedureLayer {
  private readonly app: MeowMap;
  private readonly map: L.Map;
  private readonly renderer: L.Canvas;
  private readonly group: L.LayerGroup;
  private data: FeatureCollection | null = null;
  private showSid = true;
  private showStar = true;
  private layers: L.GeoJSON[] = [];

  constructor(app: MeowMap) {
    this.app = app;
    this.map = app.map as L.Map;
    this.renderer = L.canvas({ padding: 0.5 });
    this.group = L.layerGroup().addTo(this.map);
  }

  setShowSid(v: boolean): void {
    if (v === this.showSid) return;
    this.showSid = v;
    this.render();
  }

  setShowStar(v: boolean): void {
    if (v === this.showStar) return;
    this.showStar = v;
    this.render();
  }

  /** 设置当前机场的程序（切到其它机场时替换）。 */
  setData(data: FeatureCollection | null): void {
    this.data = data;
    this.render();
  }

  clear(): void {
    this.setData(null);
  }

  /** 图源切换后坐标系变化，按当前数据重投影。 */
  invalidate(): void {
    this.render();
  }

  /** 当前数据里 SID / STAR 条数（用于界面提示）。 */
  counts(): { sid: number; star: number } {
    let sid = 0;
    let star = 0;
    for (const f of this.data?.features ?? []) {
      if (f.properties?.type === 'SID') sid++;
      else if (f.properties?.type === 'STAR') star++;
    }
    return { sid, star };
  }

  private render(): void {
    for (const l of this.layers) this.group.removeLayer(l);
    this.layers = [];
    if (!this.data) return;
    const feats = this.data.features.filter((f) => {
      const t = f.properties?.type;
      return t === 'SID' ? this.showSid : t === 'STAR' ? this.showStar : false;
    });
    if (!feats.length) return;
    const data: FeatureCollection = { type: 'FeatureCollection', features: feats };
    for (const off of copyOffsets(this.map)) {
      const layer = L.geoJSON(data, {
        renderer: this.renderer,
        coordsToLatLng: (c: number[]) => {
          const p = this.app.toLocal(c[1], c[0] + off);
          return L.latLng(p.lat, p.lng);
        },
        style: (f) => {
          const sid = f?.properties?.type === 'SID';
          return {
            color: sid ? SID_COLOR : STAR_COLOR,
            weight: 1.5,
            opacity: 0.8,
          };
        },
        onEachFeature: (f, l) => {
          const p = (f.properties ?? {}) as { type?: string; name?: string; transition?: string };
          const label = `${p.type ?? ''} ${p.name ?? ''}${p.transition ? ` · ${p.transition}` : ''}`;
          l.bindTooltip(label.trim(), { sticky: true });
        },
      } as L.GeoJSONOptions);
      layer.addTo(this.group);
      this.layers.push(layer);
    }
  }
}
