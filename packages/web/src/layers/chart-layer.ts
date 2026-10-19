import L from 'leaflet';
import type { MeowMap } from 'meow-tile-kit';
import { skyvectorRawUrl } from '../api';

export type ChartKind = 'vfr' | 'lo' | 'hi';

/** SkyVector World 系列图表 id（Jeppesen 数据，仅供个人测试）。 */
export const CHART_PROTOS: Record<ChartKind, number> = { vfr: 301, lo: 302, hi: 304 };

/** 各图世界像素宽（/api/init 的 width）；网格瓦片数 N = W/256/SCALORS[protoid][scale]。
 *  上游逻辑（skyvector.js setProj）：maxzoom 为奇数 → scalors2（×2^(1/3)），偶数 → scalors1（×1.5）。
 *  VFR maxzoom=21（奇），Lo=20 / Hi=18（偶）。 */
const CHART_CFG: Record<ChartKind, { w: number; mz: number }> = {
  vfr: { w: 524288, mz: 21 },
  lo: { w: 393216, mz: 20 },
  hi: { w: 196608, mz: 18 },
};

const SCALORS2 = [2 / 3, 1, 4 / 3, 2, 8 / 3, 4, 16 / 3, 8, 32 / 3, 16, 64 / 3, 32, 128 / 3, 64, 256 / 3, 128, 512 / 3, 256, 1024 / 3, 512, 2048 / 3, 1024, 4096 / 3, 2048];
const SCALORS1 = [0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048];

function scalors(kind: ChartKind): number[] {
  return CHART_CFG[kind].mz % 2 ? SCALORS2 : SCALORS1;
}

function gridSize(kind: ChartKind, scale: number): number {
  return Math.round(CHART_CFG[kind].w / 256 / scalors(kind)[scale]);
}

/** 为 web 缩放 z 选 SkyVector scale：优先取分辨率不低于 2^z 中最粗的一档（缩小采样最省、不放大），
 *  无解时退回不超过 2^z 的最细一档（放大渲染，天然受上游最大缩放限制）。 */
function pickScale(kind: ChartKind, z: number): number {
  let down = -1;
  let downN = Infinity;
  let up = -1;
  const nScale = scalors(kind).length;
  for (let s = 0; s < nScale; s++) {
    const n = gridSize(kind, s);
    if (n < 2) break;
    if (n > 2 ** (z + 1)) continue;
    if (n >= 2 ** z) {
      if (n < downN) {
        downN = n;
        down = s;
      }
      continue;
    }
    up = s; // 第一个低于 2^z 的（最接近的放大档）
    break;
  }
  return down >= 0 ? down : up >= 0 ? up : nScale - 1;
}

/** 原生瓦片图片缓存（跨 zoom/图表共享，URL 唯一）。 */
const imgCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadTileImage(url: string): Promise<HTMLImageElement | null> {
  let p = imgCache.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    imgCache.set(url, p);
    if (imgCache.size > 4000) {
      const firstKey = imgCache.keys().next().value as string | undefined;
      if (firstKey) imgCache.delete(firstKey);
    }
  }
  return p;
}

/** 把 SkyVector 非 2 幂网格裁剪/拼接成标准 256px XYZ 瓦片的 GridLayer。 */
class ChartTileGrid extends L.GridLayer {
  private readonly kind: ChartKind;

  constructor(kind: ChartKind, options: L.GridLayerOptions) {
    super(options);
    this.kind = kind;
  }

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const canvas = L.DomUtil.create('canvas', 'leaflet-tile') as HTMLCanvasElement;
    canvas.width = 256;
    canvas.height = 256;
    const protoid = CHART_PROTOS[this.kind];
    const scale = pickScale(this.kind, coords.z);
    const n = gridSize(this.kind, scale);
    const q = n / 2 ** coords.z; // 每 dest px 对应 q 个 source px（q>1 缩小，q<1 放大）
    const x0 = coords.x * 256 * q;
    const y0 = coords.y * 256 * q;
    const x1 = x0 + 256 * q;
    const y1 = y0 + 256 * q;
    const tx0 = Math.floor(x0 / 256);
    const tx1 = Math.floor((x1 - 1e-6) / 256);
    const ty0 = Math.floor(y0 / 256);
    const ty1 = Math.floor((y1 - 1e-6) / 256);

    const urls: string[] = [];
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        if (tx >= 0 && ty >= 0 && tx < n && ty < n) urls.push(skyvectorRawUrl(protoid, scale, tx, ty));
      }
    }
    Promise.all(urls.map((u) => loadTileImage(u))).then((imgs) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return done(undefined, canvas);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      let k = 0;
      for (let tx = tx0; tx <= tx1; tx++) {
        for (let ty = ty0; ty <= ty1; ty++) {
          if (!(tx >= 0 && ty >= 0 && tx < n && ty < n)) continue;
          const img = imgs[k++];
          if (!img) continue;
          const sx0 = Math.max(x0, tx * 256);
          const sy0 = Math.max(y0, ty * 256);
          const sx1 = Math.min(x1, (tx + 1) * 256);
          const sy1 = Math.min(y1, (ty + 1) * 256);
          if (sx1 <= sx0 || sy1 <= sy0) continue;
          ctx.drawImage(img, sx0 - tx * 256, sy0 - ty * 256, sx1 - sx0, sy1 - sy0, (sx0 - x0) / q, (sy0 - y0) / q, (sx1 - sx0) / q, (sy1 - sy0) / q);
        }
      }
      done(undefined, canvas);
    });
    return canvas;
  }
}

/**
 * SkyVector 航图叠加：World VFR / World Lo / World Hi。
 * 上游网格是各图固定世界宽度的非 2 幂网格，由 ChartTileGrid 客户端 canvas 裁剪拼接对齐到 Web Mercator。
 * 互斥（三选一）由设置面板/图例开关层保证。
 */
export class ChartLayer {
  private readonly map: L.Map;
  private readonly layers = new Map<ChartKind, L.GridLayer>();

  constructor(app: MeowMap) {
    this.map = app.map as L.Map;
    const pane = this.map.createPane('skyvectorPane');
    pane.style.zIndex = '250'; // 底图(200)之上、空域/航路 canvas(overlayPane 400)之下
    for (const kind of Object.keys(CHART_PROTOS) as ChartKind[]) {
      const layer = new ChartTileGrid(kind, {
        pane: 'skyvectorPane',
        minZoom: 1,
        maxZoom: 12,
        opacity: 0.92,
        keepBuffer: 1,
        bounds: L.latLngBounds([-85.05, -180], [85.05, 180]),
      });
      this.layers.set(kind, layer);
    }
  }

  setChartVisible(kind: ChartKind, on: boolean): void {
    const layer = this.layers.get(kind);
    if (!layer) return;
    if (on) layer.addTo(this.map);
    else this.map.removeLayer(layer);
  }

  /** 关闭所有航图。 */
  hideAll(): void {
    for (const layer of this.layers.values()) this.map.removeLayer(layer);
  }
}
