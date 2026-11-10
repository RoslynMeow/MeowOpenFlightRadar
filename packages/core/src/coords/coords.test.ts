import { describe, expect, it } from 'vitest';
import { bboxFromRadius, bboxFromRadiusSplit } from './radius.js';
import { formatCoordinate } from './format.js';
import { parseCoordinate } from './parse.js';
import { officialMapcode } from './mapcode-official.js';

const BEIJING = { lat: 39.9042, lon: 116.4074 };

function contains(b: { lamin: number; lomin: number; lamax: number; lomax: number }, p: { lat: number; lon: number }) {
  return p.lat >= b.lamin && p.lat <= b.lamax && p.lon >= b.lomin && p.lon <= b.lomax;
}

describe('parseCoordinate', () => {
  const cases: Array<[string, string]> = [
    ['decimal', '39.904200, 116.407400'],
    ['dm', "39° 54.2520', 116° 24.4440'"],
    ['dms', '39° 54\' 15.120" 116° 24\' 26.640"'],
    ['geohash', 'wx4g0bm'],
    ['geohash36', 'st4f0a'],
    ['georef', 'PTJL5424'],
    ['utm', '50N 449345 4417292'],
    ['mgrs', '50S AA 40123 98803'],
    ['csquares', '1:0311:96:94:00:47'],
    ['imw', 'NJ-50'],
    ['marsden', 'N12-30 (9°×6°)'],
    ['qdgc', 'N39E116_N'],
    ['wmo', 'N12-30 (9°×6°)'],
    ['nac', 'QJ9A TZT3'],
    ['olc', '8PFRWC34+MX'],
    ['mapcode', 'TQ37.JS9K'],
  ];

  for (const [format, input] of cases) {
    it(`parses ${format}`, () => {
      const r = parseCoordinate(input, { format: format as never });
      expect(r).not.toBeNull();
      expect(r?.format).toBe(format);

      if (format === 'decimal' || format === 'dm' || format === 'dms') {
        expect(r?.precisionM).toBe(0);
        expect(r?.bbox.lamin).toBe(r?.bbox.lamax);
        expect(r?.lat).toBeCloseTo(BEIJING.lat, 5);
        expect(r?.lon).toBeCloseTo(BEIJING.lon, 5);
        return;
      }

      expect(r?.precisionM).toBeGreaterThan(0);
      expect(contains(r!.bbox, { lat: r!.lat, lon: r!.lon })).toBe(true);

      // IMW/Marsden/WMO 是地图分幅，中心点可能离北京较远，但格子应覆盖北京。
      if (format === 'imw' || format === 'marsden' || format === 'wmo') {
        expect(contains(r!.bbox, BEIJING)).toBe(true);
      } else {
        expect(Math.abs(r!.lat - BEIJING.lat)).toBeLessThan(0.1);
        expect(Math.abs(r!.lon - BEIJING.lon)).toBeLessThan(0.1);
      }
    });
  }

  it('decodes wx4g0bm exactly', () => {
    const r = parseCoordinate('wx4g0bm');
    expect(r?.format).toBe('geohash');
    expect(r?.lat).toBeCloseTo(39.9044, 4);
    expect(r?.lon).toBeCloseTo(116.4077, 4);
    expect(r!.bbox.lamin).toBeCloseTo(39.9037, 4);
    expect(r!.bbox.lomax).toBeCloseTo(116.4084, 4);
  });

  it('auto-detects imw (missing from meow-tile-kit-core AUTO_ORDER)', () => {
    const r = parseCoordinate('NJ-50');
    expect(r?.format).toBe('imw');
    expect(contains(r!.bbox, BEIJING)).toBe(true);
  });

  it('supports lon,lat order for bare numeric pairs', () => {
    const r = parseCoordinate('116.4074, 39.9042', { order: 'lonlat' });
    expect(r?.lat).toBeCloseTo(BEIJING.lat, 6);
    expect(r?.lon).toBeCloseTo(BEIJING.lon, 6);
  });

  it('supports explicit prefixes and strict mode', () => {
    expect(parseCoordinate('geohash:wx4g0bm')?.format).toBe('geohash');
    expect(() => parseCoordinate('not a coordinate', { strict: true })).toThrow();
  });

  it('uses official Geohash-36 only when requested', () => {
    expect(parseCoordinate('9LVB4BH89g', { format: 'geohash36-official' })?.lat).toBeCloseTo(40.689, 2);
    expect(parseCoordinate('st4f0a', { format: 'geohash36-official' })).toBeNull();
  });
});

describe('formatCoordinate', () => {
  it('round-trips geohash', () => {
    const s = formatCoordinate(BEIJING.lat, BEIJING.lon, 'geohash');
    expect(s).toBe('wx4g0bm');
  });

  it('encodes official Geohash-36 examples', () => {
    expect(formatCoordinate(40.689167, -74.044444, 'geohash36-official')).toBe('9LVB4BH89g');
    expect(formatCoordinate(51.504444, -0.086667, 'geohash36-official')).toBe('bdrdC26BqH');
  });

  it('round-trips official mapcode with a territory', () => {
    const code = formatCoordinate(BEIJING.lat, BEIJING.lon, 'mapcode', {
      mapcodeTerritory: 'CN',
      officialMapcode,
    });
    const r = parseCoordinate(code, {
      format: 'mapcode',
      mapcodeTerritory: 'CN',
      officialMapcode,
    });
    expect(r).not.toBeNull();
    expect(r!.lat).toBeCloseTo(BEIJING.lat, 4);
    expect(r!.lon).toBeCloseTo(BEIJING.lon, 4);
  });
});

describe('bboxFromRadius', () => {
  it('returns a bbox containing the point', () => {
    const b = bboxFromRadius(BEIJING.lat, BEIJING.lon, { radius: 10 });
    expect(contains(b, BEIJING)).toBe(true);
    expect(b.lamax - b.lamin).toBeCloseTo(0.18, 2);
  });

  it('handles the antimeridian', () => {
    const b = bboxFromRadius(0, 179.9, { radius: 50 });
    expect(b.lomax).toBeGreaterThan(180);
    const parts = bboxFromRadiusSplit(0, 179.9, { radius: 50 });
    expect(parts).toHaveLength(2);
    expect(parts[0].lomax).toBe(180);
    expect(parts[1].lomin).toBe(-180);
  });

  it('keeps a valid latitude range when the circle contains a pole', () => {
    const b = bboxFromRadius(89.9, 0, { radius: 100 });
    expect(b.lamin).toBeGreaterThan(88);
    expect(b.lamax).toBe(90);
    expect(b.lomin).toBe(-180);
    expect(b.lomax).toBe(180);
  });

  it('uses km by default and supports nm/m', () => {
    const km = bboxFromRadius(BEIJING.lat, BEIJING.lon, { radius: 10 });
    const nm = bboxFromRadius(BEIJING.lat, BEIJING.lon, { radius: 10, unit: 'nm' });
    expect(nm.lamax - nm.lamin).toBeGreaterThan(km.lamax - km.lamin);
    const m = bboxFromRadius(BEIJING.lat, BEIJING.lon, { radius: 1000, unit: 'm' });
    expect(m.lamax - m.lamin).toBeGreaterThan(0);
  });
});
