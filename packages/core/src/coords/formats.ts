import {
  type CoordFormat,
  type LatLng,
  csquares,
  decodeCsquares,
  decodeDd,
  decodeDm,
  decodeDms,
  decodeGeohash,
  decodeGeohash36,
  decodeGeoref,
  decodeGeoUri,
  decodeImw,
  decodeIso6709,
  decodeMapcode,
  decodeMarsden,
  decodeMgrs,
  decodeNac,
  decodeOlc,
  decodeQdgc,
  decodeUtm,
  decodeWmo,
  defaultFormats,
  extraFormats,
  geohash,
  geohash36f,
  georef,
  imw,
  mapcode,
  marsden,
  mgrs,
  nac,
  olc,
  qdgc,
  utm,
  wmo,
} from 'meow-tile-kit-core';
import {
  decodeGeohash36Official,
  encodeGeohash36Official,
} from './geohash36-official.js';
import type { CoordFormatId } from './types.js';

export interface FormatDef {
  id: CoordFormatId;
  /** `meow-tile-kit-core` 的格式 key；自定义格式除外。 */
  key: string;
  format: CoordFormat;
  parse(input: string): LatLng | null;
  /** 官方 Geohash-36 等需要显式启用的格式。 */
  explicitOnly?: boolean;
}

const byKey = new Map<string, CoordFormat>(
  [...defaultFormats, ...extraFormats].map((f) => [f.key, f]),
);

function libFormat(key: string): CoordFormat {
  const f = byKey.get(key);
  if (!f) throw new Error(`meow-tile-kit-core: missing format "${key}"`);
  return f;
}

const officialGeohash36Format: CoordFormat = {
  key: 'geohash36-official',
  label: 'Geohash-36 (official)',
  formatLat: (v) => `${v.toFixed(6)}°`,
  formatLng: (v) => `${v.toFixed(6)}°`,
  coord(lat, lng) {
    return encodeGeohash36Official(lat, lng) ?? '';
  },
  parse(input) {
    const cell = decodeGeohash36Official(input);
    return cell ? { lat: cell.lat, lng: cell.lon } : null;
  },
};

function def(
  id: CoordFormatId,
  key: string,
  parse: (s: string) => LatLng | null,
  format?: CoordFormat,
  explicitOnly?: boolean,
): FormatDef {
  return { id, key, format: format ?? libFormat(key), parse, ...(explicitOnly ? { explicitOnly } : {}) };
}

export const FORMATS: Record<CoordFormatId, FormatDef> = {
  decimal: def('decimal', 'dd', decodeDd),
  dm: def('dm', 'dm', decodeDm),
  dms: def('dms', 'dms', decodeDms),
  geohash: def('geohash', 'geohash', decodeGeohash, geohash),
  geohash36: def('geohash36', 'geohash36', decodeGeohash36, geohash36f),
  'geohash36-official': def(
    'geohash36-official',
    'geohash36-official',
    (s) => {
      const cell = decodeGeohash36Official(s);
      return cell ? { lat: cell.lat, lng: cell.lon } : null;
    },
    officialGeohash36Format,
    true,
  ),
  georef: def('georef', 'georef', decodeGeoref, georef),
  utm: def('utm', 'utm', decodeUtm, utm),
  mgrs: def('mgrs', 'mgrs', decodeMgrs, mgrs),
  csquares: def('csquares', 'csquares', decodeCsquares, csquares),
  imw: def('imw', 'imw', decodeImw, imw),
  marsden: def('marsden', 'marsden', decodeMarsden, marsden),
  qdgc: def('qdgc', 'qdgc', decodeQdgc, qdgc),
  wmo: def('wmo', 'wmo', decodeWmo, wmo),
  nac: def('nac', 'nac', decodeNac, nac),
  olc: def('olc', 'olc', decodeOlc, olc),
  mapcode: def('mapcode', 'mapcode', decodeMapcode, mapcode),
  iso6709: def('iso6709', 'iso6709', decodeIso6709),
  geouri: def('geouri', 'geouri', decodeGeoUri),
};

/** 你图里的 16 种格式。 */
export const CORE_FORMAT_IDS: CoordFormatId[] = [
  'decimal',
  'dm',
  'dms',
  'geohash',
  'geohash36',
  'georef',
  'utm',
  'mgrs',
  'csquares',
  'imw',
  'marsden',
  'qdgc',
  'wmo',
  'nac',
  'olc',
  'mapcode',
];

export const ALL_FORMAT_IDS = Object.keys(FORMATS) as CoordFormatId[];

/**
 * 自动识别顺序。`imw` 是 `meow-tile-kit-core` 的 `AUTO_ORDER` 漏掉的。
 * `geohash36-official` 不参与自动识别，避免和 `geohash` / `geohash36` 混淆。
 * `marsden` 与 `wmo` 字符串相同，自动识别优先返回 `marsden`。
 */
export const AUTO_ORDER: CoordFormatId[] = [
  'iso6709',
  'geouri',
  'utm',
  'mgrs',
  'georef',
  'marsden',
  'qdgc',
  'wmo',
  'csquares',
  'imw',
  'olc',
  'mapcode',
  'dms',
  'dm',
  'decimal',
  'geohash',
  'geohash36',
  'nac',
];

export function isCoordFormatId(v: unknown): v is CoordFormatId {
  return typeof v === 'string' && v in FORMATS;
}
