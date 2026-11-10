import type { LatLng } from 'meow-tile-kit-core';
import type { BBox } from '../shared/index.js';
import { cellBBox } from './cells.js';
import { AUTO_ORDER, FORMATS, isCoordFormatId } from './formats.js';
import { decodeGeohash36Official } from './geohash36-official.js';
import type {
  CoordFormatId,
  ParseCoordinateOptions,
  ParsedCoordinate,
} from './types.js';

const BARE_PAIR = /^\s*([+-]?\d+(?:\.\d+)?)\s*[, ]\s*([+-]?\d+(?:\.\d+)?)\s*$/;

function fail(input: string, options: ParseCoordinateOptions, message: string): null {
  if (options.strict) throw new Error(`${message}: ${input}`);
  return null;
}

/** 只对纯数字经纬度对应用 lon,lat 顺序；DMS/UTM 等格式有字母或符号，不受影响。 */
function applyOrder(input: string, order: ParseCoordinateOptions['order']): string {
  if (order !== 'lonlat') return input;
  const m = input.match(BARE_PAIR);
  return m ? `${m[2]}, ${m[1]}` : input;
}

interface ParsedInternal {
  lat: number;
  lon: number;
  bbox?: BBox;
  precisionM?: number;
  /** 官方 Geohash-36 等已经带 bbox 的格式。 */
  hasBBox?: boolean;
}

function parseWithFormat(
  id: CoordFormatId,
  input: string,
  options: ParseCoordinateOptions,
): ParsedInternal | null {
  if (id === 'geohash36-official') {
    const cell = decodeGeohash36Official(input);
    return cell
      ? { lat: cell.lat, lon: cell.lon, bbox: cell.bbox, hasBBox: true }
      : null;
  }

  if (id === 'mapcode' && options.mapcodeTerritory) {
    if (!options.officialMapcode) {
      throw new Error(
        'mapcodeTerritory requires an officialMapcode decoder; import { officialMapcode } from "meow-open-flight-core/coords/mapcode-official"',
      );
    }
    const r = options.officialMapcode.decode(input, options.mapcodeTerritory);
    if (!r) return null;
    return {
      lat: r.lat,
      lon: r.lon,
      bbox: r.bbox,
      precisionM: r.precisionM,
      hasBBox: Boolean(r.bbox),
    };
  }

  const def = FORMATS[id];
  if (!def) return null;
  const ll: LatLng | null = def.parse(input);
  return ll ? { lat: ll.lat, lon: ll.lng } : null;
}

function finish(
  id: CoordFormatId,
  input: string,
  parsed: ParsedInternal,
): ParsedCoordinate {
  const cell = parsed.hasBBox && parsed.bbox
    ? {
        bbox: parsed.bbox,
        precisionM:
          parsed.precisionM ?? inferPrecision(parsed.bbox, parsed.lat),
      }
    : cellBBox(id, input, parsed.lat, parsed.lon);

  return {
    lat: parsed.lat,
    lon: parsed.lon,
    format: id,
    bbox: cell.bbox,
    precisionM: cell.precisionM,
    input,
  };
}

function inferPrecision(bbox: BBox, lat: number): number {
  const latM = (bbox.lamax - bbox.lamin) * 111320;
  const lonM =
    Math.abs(bbox.lomax - bbox.lomin) *
    111320 *
    Math.abs(Math.cos((lat * Math.PI) / 180));
  return Math.max(latM, lonM);
}

function splitPrefix(input: string): { format?: CoordFormatId; value: string } {
  const m = input.match(/^([a-z0-9-]+)\s*:\s*(.*)$/i);
  if (m) {
    const key = m[1].toLowerCase();
    if (isCoordFormatId(key)) return { format: key, value: m[2] };
  }
  return { value: input };
}

/**
 * 解析任意受支持的坐标字符串。
 *
 * - 自动识别顺序见 `AUTO_ORDER`；`imw` 已补上（`meow-tile-kit-core` 原版漏了）。
 * - `geohash36-official` 只在显式指定时启用，避免和 `geohash` / `geohash36` 混淆。
 * - `mapcodeTerritory` 需要同时传 `officialMapcode`（由 coords/mapcode-official 子路径提供）。
 */
export function parseCoordinate(
  input: string,
  options: ParseCoordinateOptions = {},
): ParsedCoordinate | null {
  if (typeof input !== 'string') return null;
  const original = input;
  let text = input.trim();
  if (!text) return fail(original, options, 'empty coordinate');

  // 支持 `geohash:wx4g0bm`、`dms:...` 这种显式前缀。
  const prefixed = splitPrefix(text);
  if (prefixed.format) {
    text = prefixed.value.trim();
  }

  const format = prefixed.format ?? options.format;
  text = applyOrder(text, options.order);

  if (format) {
    const parsed = parseWithFormat(format, text, options);
    return parsed ? finish(format, original, parsed) : fail(original, options, `invalid ${format}`);
  }

  const order = options.formats ?? AUTO_ORDER;
  for (const id of order) {
    const def = FORMATS[id];
    if (!def) continue;
    if (def.explicitOnly) continue;
    const parsed = parseWithFormat(id, text, options);
    if (parsed) return finish(id, original, parsed);
  }

  return fail(original, options, 'unsupported coordinate');
}

/** 只返回识别出的格式，不构造 bbox。 */
export function detectCoordFormat(
  input: string,
  options: ParseCoordinateOptions = {},
): CoordFormatId | null {
  const parsed = parseCoordinate(input, { ...options, strict: false });
  return parsed?.format ?? null;
}

/** 解析并直接返回 bbox；解析失败返回 null。 */
export function parseCoordinateToBBox(
  input: string,
  options: ParseCoordinateOptions = {},
): BBox | null {
  return parseCoordinate(input, options)?.bbox ?? null;
}
