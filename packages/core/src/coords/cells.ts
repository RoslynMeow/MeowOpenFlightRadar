import type { BBox } from '../shared/index.js';
import { decodeGeohash36Official } from './geohash36-official.js';
import type { CoordFormatId } from './types.js';

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111320;
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';
const OLC_ALPHABET = '23456789CFGHJMPQRVWX';
const MAPCODE_BASE = 28;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function normalizeLon(v: number): number {
  let lon = v;
  while (lon < -180) lon += 360;
  while (lon >= 180) lon -= 360;
  return lon;
}

function zeroBBox(lat: number, lon: number): BBox {
  return { lamin: lat, lomin: lon, lamax: lat, lomax: lon };
}

function bboxAround(lat: number, lon: number, latSpan: number, lonSpan: number): BBox {
  if (latSpan <= 0 && lonSpan <= 0) return zeroBBox(lat, lon);
  if (latSpan >= 180 || lonSpan >= 360) {
    return { lamin: -90, lomin: -180, lamax: 90, lomax: 180 };
  }
  const halfLat = latSpan / 2;
  const halfLon = lonSpan / 2;
  const lamin = clamp(lat - halfLat, -90, 90);
  const lamax = clamp(lat + halfLat, -90, 90);
  const lomin = normalizeLon(lon - halfLon);
  return { lamin, lomin, lamax, lomax: lomin + lonSpan };
}

function bboxFromMeters(lat: number, lon: number, meters: number): BBox {
  if (!(meters > 0)) return zeroBBox(lat, lon);
  const latSpan = meters / M_PER_DEG_LAT;
  const cosLat = Math.abs(Math.cos(lat * DEG));
  const lonSpan = cosLat < 1e-9 ? 360 : meters / (M_PER_DEG_LAT * cosLat);
  return bboxAround(lat, lon, latSpan, lonSpan);
}

export function bboxPrecisionM(bbox: BBox, lat: number): number {
  const latM = (bbox.lamax - bbox.lamin) * M_PER_DEG_LAT;
  const lonM =
    Math.abs(bbox.lomax - bbox.lomin) * M_PER_DEG_LAT * Math.abs(Math.cos(lat * DEG));
  return Math.max(latM, lonM);
}

function geohashCell(input: string, alphabet: string, maxIndex: number): BBox | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let isLon = true;

  for (const ch of s) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0 || idx > maxIndex) return null;
    for (let mask = 16; mask; mask >>= 1) {
      const on = (idx & mask) !== 0;
      if (isLon) {
        const mid = (lonMin + lonMax) / 2;
        if (on) lonMin = mid;
        else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (on) latMin = mid;
        else latMax = mid;
      }
      isLon = !isLon;
    }
  }

  return { lamin: latMin, lomin: lonMin, lamax: latMax, lomax: lonMax };
}

function decimalPlaces(s: string): number {
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

function utmCell(input: string, lat: number, lon: number): BBox | null {
  const m = input.trim().match(/^(\d{1,2})\s*([NS])\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  const places = Math.max(decimalPlaces(m[3]), decimalPlaces(m[4]));
  return bboxFromMeters(lat, lon, 10 ** -places);
}

function mgrsCell(input: string, lat: number, lon: number): BBox | null {
  const m = input
    .trim()
    .toUpperCase()
    .match(/^(\d{1,2})([A-Z])\s+([A-Z])([A-Z])\s+(\d+)\s+(\d+)$/);
  if (!m) return null;
  const digits = Math.min(m[5].length, m[6].length);
  return bboxFromMeters(lat, lon, 10 ** (5 - digits));
}

function csquaresCell(input: string, lat: number, lon: number): BBox | null {
  const parts = input.trim().split(':');
  if (parts.length < 2) return null;
  const cellDeg = 10 / 10 ** Math.max(0, parts.length - 2);
  return bboxAround(lat, lon, cellDeg, cellDeg);
}

function nacCell(input: string, lat: number, lon: number): BBox | null {
  const m = input.trim().toUpperCase().match(/^([0-9A-Z]+)\s+([0-9A-Z]+)$/);
  if (!m) return null;
  const len = Math.min(m[1].length, m[2].length);
  // 与 meow-tile-kit-core 的 NAC 解码器保持一致（它使用的字母表长度是 34）。
  return bboxAround(lat, lon, 180 / 34 ** len, 360 / 34 ** len);
}

function olcCell(input: string): BBox | null {
  const clean = input.trim().toUpperCase().replace(/\s+/g, '');
  const plus = clean.indexOf('+');
  if (plus !== 8) return null;
  const chars = clean.replace('+', '');
  if (chars.length < 10) return null;

  let latRes = 20;
  let lngRes = 20;
  let lat = 0;
  let lng = 0;

  for (let p = 0; p < 5; p++) {
    const latD = OLC_ALPHABET.indexOf(chars[p * 2]);
    const lngD = OLC_ALPHABET.indexOf(chars[p * 2 + 1]);
    if (latD < 0 || lngD < 0) return null;
    lat += latD * latRes;
    lng += lngD * lngRes;
    if (p < 4) {
      latRes /= 20;
      lngRes /= 20;
    }
  }

  for (let i = 10; i < chars.length; i++) {
    const d = OLC_ALPHABET.indexOf(chars[i]);
    if (d < 0) return null;
    const rowRes = latRes / 5;
    const colRes = lngRes / 4;
    lat += Math.floor(d / 4) * rowRes;
    lng += (d % 4) * colRes;
    latRes = rowRes;
    lngRes = colRes;
  }

  return {
    lamin: lat - 90,
    lomin: lng - 180,
    lamax: lat - 90 + latRes,
    lomax: lng - 180 + lngRes,
  };
}

function mapcodeCell(input: string, lat: number, lon: number): BBox | null {
  const m = input.trim().toUpperCase().match(/^([0-9A-Z]+)\.([0-9A-Z]+)$/);
  if (!m) return null;
  const body = m[1] + m[2];
  if (body.length % 2 !== 0) return null;
  const steps = body.length / 2;
  return bboxAround(lat, lon, 180 / MAPCODE_BASE ** steps, 360 / MAPCODE_BASE ** steps);
}

/**
 * 估算某个格式字符串对应的格子范围。
 * 点格式返回零面积 bbox；网格格式按格式精度估算。
 */
export function cellBBox(
  format: CoordFormatId,
  input: string,
  lat: number,
  lon: number,
): { bbox: BBox; precisionM: number } {
  let bbox: BBox | null = null;

  switch (format) {
    case 'decimal':
    case 'dm':
    case 'dms':
    case 'iso6709':
    case 'geouri':
      bbox = zeroBBox(lat, lon);
      break;
    case 'geohash':
      bbox = geohashCell(input, BASE32, 31);
      break;
    case 'geohash36':
      bbox = geohashCell(input, BASE36, 31);
      break;
    case 'geohash36-official':
      bbox = decodeGeohash36Official(input)?.bbox ?? null;
      break;
    case 'georef':
      bbox = bboxAround(lat, lon, 1 / 60, 1 / 60);
      break;
    case 'utm':
      bbox = utmCell(input, lat, lon);
      break;
    case 'mgrs':
      bbox = mgrsCell(input, lat, lon);
      break;
    case 'csquares':
      bbox = csquaresCell(input, lat, lon);
      break;
    case 'imw':
      bbox = bboxAround(lat, lon, 4, 6);
      break;
    case 'marsden':
    case 'wmo':
      bbox = bboxAround(lat, lon, 1, 1);
      break;
    case 'qdgc':
      bbox = bboxAround(lat, lon, 0.25, 0.25);
      break;
    case 'nac':
      bbox = nacCell(input, lat, lon);
      break;
    case 'olc':
      bbox = olcCell(input);
      break;
    case 'mapcode':
      bbox = mapcodeCell(input, lat, lon);
      break;
    default:
      bbox = zeroBBox(lat, lon);
  }

  if (!bbox) return { bbox: zeroBBox(lat, lon), precisionM: 0 };
  return { bbox, precisionM: bboxPrecisionM(bbox, lat) };
}
