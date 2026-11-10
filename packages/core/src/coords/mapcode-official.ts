import { decode, decodeToRectangle, encodeToShortest, Territory } from 'mapcode-ts';
import type { BBox } from '../shared/index.js';
import type { OfficialMapcodeDecoder } from './types.js';

function resolveTerritory(code: string): Territory | null {
  const s = code.trim();
  if (!s) return null;
  const attempts = [
    () => Territory.fromCountryISO2(s),
    () => Territory.fromCountryISO3(s),
    () => Territory.fromString(s),
  ];
  for (const attempt of attempts) {
    try {
      const t = attempt();
      if (t) return t;
    } catch {
      /* try next */
    }
  }
  return null;
}

function rectangleBBox(code: string, territory: Territory): BBox | null {
  try {
    const rect = decodeToRectangle(code, territory);
    if (!rect.isDefined()) return null;
    const sw = rect.getSouthWest();
    const ne = rect.getNorthEast();
    return {
      lamin: sw.getLatDeg(),
      lomin: sw.getLonDeg(),
      lamax: ne.getLatDeg(),
      lomax: ne.getLonDeg(),
    };
  } catch {
    return null;
  }
}

/**
 * 官方 Mapcode 解码/编码器（基于 `mapcode-ts`，Apache-2.0）。
 *
 * 需要安装可选 peer：
 * ```bash
 * npm i mapcode-ts
 * ```
 *
 * ```ts
 * import { officialMapcode } from 'meow-open-flight-core/coords/mapcode-official';
 * parseCoordinate('TQ37.JS9K', { mapcodeTerritory: 'CN', officialMapcode });
 * ```
 */
export const officialMapcode: OfficialMapcodeDecoder = {
  decode(code, territoryCode) {
    const territory = resolveTerritory(territoryCode);
    if (!territory) return null;
    try {
      const point = decode(code, territory);
      return {
        lat: point.getLatDeg(),
        lon: point.getLonDeg(),
        bbox: rectangleBBox(code, territory) ?? undefined,
      };
    } catch {
      return null;
    }
  },

  encode(lat, lon, territoryCode) {
    const territory = resolveTerritory(territoryCode);
    if (!territory) return null;
    try {
      return encodeToShortest(lat, lon, territory).getCode();
    } catch {
      return null;
    }
  },
};

export { Territory };
