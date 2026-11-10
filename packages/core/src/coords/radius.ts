import type { BBox } from '../shared/index.js';
import type { RadiusBBoxOptions } from './types.js';

const R_KM = 6371.0088;
const R_NM = 3440.065;
const R_M = 6371008.8;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function radiusToAngular(radius: number, unit: RadiusBBoxOptions['unit']): number {
  const r = unit === 'nm' ? R_NM : unit === 'm' ? R_M : R_KM;
  return radius / r;
}

function normalizeLon(v: number): number {
  let lon = v;
  while (lon < -180) lon += 360;
  while (lon >= 180) lon -= 360;
  return lon;
}

function clampLat(v: number): number {
  return Math.min(90, Math.max(-90, v));
}

function worldBox(): BBox {
  return { lamin: -90, lomin: -180, lamax: 90, lomax: 180 };
}

function computeRadiusBox(lat: number, lon: number, options: RadiusBBoxOptions): BBox {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('bboxFromRadius: lat/lon must be finite');
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('bboxFromRadius: lat must be in [-90,90] and lon in [-180,180]');
  }

  const radius = Number.isFinite(options.radius) ? Math.max(0, options.radius) : 0;
  const angular = radiusToAngular(radius, options.unit);
  if (!(angular > 0)) {
    return { lamin: lat, lomin: lon, lamax: lat, lomax: lon };
  }
  if (angular >= Math.PI) return worldBox();

  const latRad = lat * DEG;
  const lonRad = lon * DEG;
  const latMinRad = latRad - angular;
  const latMaxRad = latRad + angular;

  const lamin = clampLat(latMinRad * RAD);
  const lamax = clampLat(latMaxRad * RAD);

  let lonMinDeg: number;
  let lonMaxDeg: number;
  let containsPole = false;

  if (latMinRad <= -Math.PI / 2 || latMaxRad >= Math.PI / 2) {
    // 圆包含极点，经度覆盖全球，但纬度范围仍然有效。
    containsPole = true;
    lonMinDeg = -180;
    lonMaxDeg = 180;
  } else {
    const sinAngular = Math.sin(angular);
    const cosLat = Math.cos(latRad);
    const dLon = Math.asin(Math.min(1, Math.abs(sinAngular / cosLat)));
    lonMinDeg = (lonRad - dLon) * RAD;
    lonMaxDeg = (lonRad + dLon) * RAD;
  }

  if (containsPole) {
    if (lamin <= -90 && lamax >= 90) return worldBox();
    return { lamin, lomin: -180, lamax, lomax: 180 };
  }

  const width = lonMaxDeg - lonMinDeg;
  if (width >= 360) return worldBox();

  const lomin = normalizeLon(lonMinDeg);
  return { lamin, lomin, lamax, lomax: lomin + width };
}

/**
 * 点 + 半径 → 外接 bbox。
 *
 * 返回的 bbox 是**外接矩形**，不是圆本身。
 * 跨日期变更线时 `lomax` 可能大于 180（沿用项目 BBox 约定）。
 */
export function bboxFromRadius(
  lat: number,
  lon: number,
  options: RadiusBBoxOptions,
): BBox {
  return computeRadiusBox(lat, lon, options);
}

/**
 * 点 + 半径 → 标准 bbox 列表。
 * 跨日期变更线时返回两个 bbox（[-180,180] 内），否则返回一个。
 */
export function bboxFromRadiusSplit(
  lat: number,
  lon: number,
  options: RadiusBBoxOptions,
): BBox[] {
  const box = computeRadiusBox(lat, lon, options);
  if (box.lomax <= 180) return [box];
  return [
    { lamin: box.lamin, lomin: box.lomin, lamax: box.lamax, lomax: 180 },
    { lamin: box.lamin, lomin: -180, lamax: box.lamax, lomax: box.lomax - 360 },
  ];
}
