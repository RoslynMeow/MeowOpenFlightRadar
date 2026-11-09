import { describe, expect, it } from 'vitest';
import { inBBox, isAircraftProvider, parseBBoxString, splitBBox } from './index';

describe('parseBBoxString', () => {
  it('parses a valid bbox', () => {
    expect(parseBBoxString('10,20,30,40')).toEqual({ lamin: 10, lomin: 20, lamax: 30, lomax: 40 });
  });

  it('rejects malformed input', () => {
    expect(parseBBoxString('1,2,3')).toBeNull();
    expect(parseBBoxString('a,b,c,d')).toBeNull();
    expect(parseBBoxString(null)).toBeNull();
  });

  it('rejects inverted latitude order', () => {
    expect(parseBBoxString('30,20,10,40')).toBeNull();
  });
});

describe('splitBBox', () => {
  it('keeps a normal bbox', () => {
    expect(splitBBox({ lamin: 0, lomin: 10, lamax: 20, lomax: 30 })).toEqual([
      { lamin: 0, lomin: 10, lamax: 20, lomax: 30 },
    ]);
  });

  it('splits across the antimeridian', () => {
    expect(splitBBox({ lamin: -10, lomin: 170, lamax: 10, lomax: 190 })).toEqual([
      { lamin: -10, lomin: 170, lamax: 10, lomax: 180 },
      { lamin: -10, lomin: -180, lamax: 10, lomax: -170 },
    ]);
  });

  it('returns the full world when the span is at least 360', () => {
    expect(splitBBox({ lamin: -90, lomin: -200, lamax: 90, lomax: 200 })).toEqual([
      { lamin: -90, lomin: -180, lamax: 90, lomax: 180 },
    ]);
  });
});

describe('inBBox', () => {
  const bbox = { lamin: 10, lomin: 20, lamax: 30, lomax: 40 };

  it('includes boundaries', () => {
    expect(inBBox(10, 20, bbox)).toBe(true);
    expect(inBBox(30, 40, bbox)).toBe(true);
  });

  it('excludes points outside', () => {
    expect(inBBox(9.9, 20, bbox)).toBe(false);
    expect(inBBox(30, 40.1, bbox)).toBe(false);
  });
});

describe('isAircraftProvider', () => {
  it('accepts known providers', () => {
    expect(isAircraftProvider('flightradar24')).toBe(true);
    expect(isAircraftProvider('flightaware')).toBe(true);
  });

  it('rejects others', () => {
    expect(isAircraftProvider('opensky')).toBe(false);
    expect(isAircraftProvider(null)).toBe(false);
  });
});
