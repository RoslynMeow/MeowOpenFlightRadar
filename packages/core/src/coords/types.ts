import type { BBox } from '../shared/index.js';

/** 支持的坐标格式 ID。 */
export type CoordFormatId =
  | 'decimal'
  | 'dm'
  | 'dms'
  | 'geohash'
  | 'geohash36'
  | 'geohash36-official'
  | 'georef'
  | 'utm'
  | 'mgrs'
  | 'csquares'
  | 'imw'
  | 'marsden'
  | 'qdgc'
  | 'wmo'
  | 'nac'
  | 'olc'
  | 'mapcode'
  | 'iso6709'
  | 'geouri';

/** 解析结果：点 + 该格式的自然格子范围。 */
export interface ParsedCoordinate {
  lat: number;
  lon: number;
  format: CoordFormatId;
  /** 点格式为零面积；网格格式为格子边界。 */
  bbox: BBox;
  /** 格子大致精度（米）；点格式为 0。 */
  precisionM: number;
  /** 原始输入。 */
  input: string;
}

/** 官方 Mapcode 解码器接口；由 `meow-open-flight-core/coords/mapcode-official` 提供。 */
export interface OfficialMapcodeDecoder {
  decode(
    code: string,
    territory: string,
  ): {
    lat: number;
    lon: number;
    bbox?: BBox;
    precisionM?: number;
  } | null;
  encode?(lat: number, lon: number, territory: string): string | null;
}

export interface ParseCoordinateOptions {
  /** 强制按某个格式解析。 */
  format?: CoordFormatId;
  /** 只启用这些格式；默认使用自动识别顺序。 */
  formats?: CoordFormatId[];
  /** 纯数字经纬度对的顺序，默认 lat,lon。 */
  order?: 'latlon' | 'lonlat';
  /** 解析失败时抛错，默认返回 null。 */
  strict?: boolean;
  /** 官方 Mapcode 需要地区代码；不传则使用 Core 内置的全局解码器。 */
  mapcodeTerritory?: string;
  /** 官方 Mapcode 解码器；通常由 `coords/mapcode-official` 提供。 */
  officialMapcode?: OfficialMapcodeDecoder;
}

export interface FormatCoordinateOptions {
  /** 官方 Geohash-36 的字符数，默认 10。 */
  precision?: number;
  /** 官方 Mapcode 需要地区代码。 */
  mapcodeTerritory?: string;
  /** 官方 Mapcode 编码器。 */
  officialMapcode?: OfficialMapcodeDecoder;
}

export interface RadiusBBoxOptions {
  /** 半径数值；必须 >= 0。 */
  radius: number;
  /** 单位，默认 km。 */
  unit?: 'km' | 'nm' | 'm';
}
