import L from 'leaflet';

/** 经度归一化到 [-180, 180)。 */
export function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** 当前缩放下的世界像素宽度（与 Leaflet CRS/瓦片尺寸一致）。 */
export function worldPixelWidth(map: L.Map): number {
  const b = map.getPixelWorldBounds(map.getZoom());
  return b ? b.getSize().x : 256 * Math.pow(2, map.getZoom());
}

/**
 * 当前视野需要铺底的世界副本经度偏移（度），只包含真正与视野相交的副本。
 * 例如视野 [-101,180] 时返回 [0, 360]（360 副本负责显示 -180..-101 那一段）。
 */
export function copyOffsets(map: L.Map): number[] {
  const worldPx = worldPixelWidth(map);
  if (!worldPx) return [0];
  const span = (map.getSize().x / worldPx) * 360;
  const center = map.getCenter().lng;
  const min = center - span / 2;
  const max = center + span / 2;
  const kMin = Math.ceil((min - 180) / 360);
  const kMax = Math.floor((max + 180) / 360);
  const out: number[] = [];
  for (let k = kMin; k <= kMax; k++) out.push(k * 360);
  return out.length ? out : [0];
}

/** 把容器坐标点平移到离 prefer 最近的经度副本上。 */
export function nearestCopyX(x: number, preferX: number, worldPx: number): number {
  if (!worldPx) return x;
  return x + Math.round((preferX - x) / worldPx) * worldPx;
}
