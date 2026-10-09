import type { Geometry, Position } from 'geojson';

/** 射线法：点 (lon,lat) 是否在单个环内。 */
function pointInRing(lon: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonContains(rings: Position[][], lon: number, lat: number): boolean {
  if (!rings.length || !pointInRing(lon, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lon, lat, rings[i])) return false; // 洞
  }
  return true;
}

/** 点是否落在任意几何（Polygon / MultiPolygon）内。 */
export function pointInGeometry(lon: number, lat: number, geom: Geometry): boolean {
  if (geom.type === 'Polygon') return polygonContains(geom.coordinates, lon, lat);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some((poly) => polygonContains(poly, lon, lat));
  return false;
}
