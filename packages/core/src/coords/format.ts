import { FORMATS } from './formats.js';
import { encodeGeohash36Official } from './geohash36-official.js';
import type { CoordFormatId, FormatCoordinateOptions } from './types.js';

/**
 * 把 WGS-84 经纬度格式化成指定坐标格式。
 *
 * - `geohash36-official` 使用官方 Geohash-36 编码。
 * - `mapcode` 默认使用 `meow-tile-kit-core` 的全局编码器；
 *   传 `mapcodeTerritory` 时必须同时传 `officialMapcode`。
 */
export function formatCoordinate(
  lat: number,
  lon: number,
  format: CoordFormatId,
  options: FormatCoordinateOptions = {},
): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('formatCoordinate: lat/lon must be finite');
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('formatCoordinate: lat must be in [-90,90] and lon in [-180,180]');
  }

  if (format === 'geohash36-official') {
    const s = encodeGeohash36Official(lat, lon, options.precision ?? 10);
    if (!s) throw new Error('formatCoordinate: cannot encode geohash36-official');
    return s;
  }

  if (format === 'mapcode' && options.mapcodeTerritory) {
    if (!options.officialMapcode?.encode) {
      throw new Error(
        'mapcodeTerritory requires an officialMapcode encoder; import { officialMapcode } from "meow-open-flight-core/coords/mapcode-official"',
      );
    }
    const s = options.officialMapcode.encode(lat, lon, options.mapcodeTerritory);
    if (!s) throw new Error('formatCoordinate: cannot encode mapcode');
    return s;
  }

  const def = FORMATS[format];
  if (!def) throw new Error(`formatCoordinate: unknown format "${format}"`);
  const s = def.format.coord(lat, lon);
  if (!s) throw new Error(`formatCoordinate: cannot encode ${format}`);
  return s;
}
