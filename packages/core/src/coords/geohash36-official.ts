import type { BBox } from '../shared/index.js';

/**
 * 官方 Geohash-36（Wikipedia 定义）。
 *
 * 6×6 网格、大小写敏感、无元音，字母表：
 * `23456789bBCdDFgGhHjJKlLMnNPqQrRtTVWX`
 *
 * 注意：这和 `meow-tile-kit-core` 里的 `geohash36`（base36 变体）不是同一套算法。
 */
export const GEOHASH36_OFFICIAL_ALPHABET = '23456789bBCdDFgGhHjJKlLMnNPqQrRtTVWX';

export interface OfficialGeohash36Cell {
  lat: number;
  lon: number;
  bbox: BBox;
}

/** 去掉可选的高度前缀 `A`/`a` 和校验和 `-x`。 */
function coordinatePart(input: string): string {
  let s = input.trim();
  if (s.startsWith('A') || s.startsWith('a')) s = s.slice(1);
  const dash = s.indexOf('-');
  if (dash >= 0) s = s.slice(0, dash);
  return s;
}

export function decodeGeohash36Official(input: string): OfficialGeohash36Cell | null {
  const code = coordinatePart(input);
  if (!code) return null;

  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  for (const ch of code) {
    const idx = GEOHASH36_OFFICIAL_ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    const row = Math.floor(idx / 6);
    const col = idx % 6;
    const latStep = (latMax - latMin) / 6;
    const lonStep = (lonMax - lonMin) / 6;

    // 官方定义从西北角开始，row 0 是最北一行，col 0 是最西一列。
    const nextLatMax = latMax - row * latStep;
    const nextLatMin = nextLatMax - latStep;
    const nextLonMin = lonMin + col * lonStep;
    const nextLonMax = nextLonMin + lonStep;

    latMin = nextLatMin;
    latMax = nextLatMax;
    lonMin = nextLonMin;
    lonMax = nextLonMax;
  }

  return {
    lat: (latMin + latMax) / 2,
    lon: (lonMin + lonMax) / 2,
    bbox: { lamin: latMin, lomin: lonMin, lamax: latMax, lomax: lonMax },
  };
}

export function encodeGeohash36Official(
  lat: number,
  lon: number,
  precision = 10,
): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (!Number.isInteger(precision) || precision <= 0) return null;

  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let out = '';

  for (let i = 0; i < precision; i++) {
    const latStep = (latMax - latMin) / 6;
    const lonStep = (lonMax - lonMin) / 6;
    let row = Math.floor((latMax - lat) / latStep);
    let col = Math.floor((lon - lonMin) / lonStep);
    row = Math.min(5, Math.max(0, row));
    col = Math.min(5, Math.max(0, col));

    out += GEOHASH36_OFFICIAL_ALPHABET[row * 6 + col];

    const nextLatMax = latMax - row * latStep;
    const nextLonMin = lonMin + col * lonStep;
    latMin = nextLatMax - latStep;
    latMax = nextLatMax;
    lonMin = nextLonMin;
    lonMax = nextLonMin + lonStep;
  }

  return out;
}
