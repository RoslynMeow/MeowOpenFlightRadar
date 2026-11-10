import type { Aircraft } from 'meow-open-flight-core/shared';
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, matchesFilter, parseFilter } from './filter';

function ac(partial: Partial<Aircraft>): Aircraft {
  return { callsign: null, typeCode: null, altFt: null, ...partial } as unknown as Aircraft;
}

describe('matchesFilter', () => {
  it('accepts everything with the empty filter', () => {
    expect(matchesFilter(ac({}), EMPTY_FILTER)).toBe(true);
  });

  it('filters by callsign prefix (case-insensitive)', () => {
    const filter = { ...EMPTY_FILTER, airline: 'cca' };
    expect(matchesFilter(ac({ callsign: 'CCA123' }), filter)).toBe(true);
    expect(matchesFilter(ac({ callsign: 'CES123' }), filter)).toBe(false);
  });

  it('filters by type fragment', () => {
    const filter = { ...EMPTY_FILTER, type: '738' };
    expect(matchesFilter(ac({ typeCode: 'B738' }), filter)).toBe(true);
    expect(matchesFilter(ac({ typeCode: 'A320' }), filter)).toBe(false);
  });

  it('filters by altitude range and drops unknown altitudes', () => {
    const filter = { ...EMPTY_FILTER, minAlt: 10000, maxAlt: 30000 };
    expect(matchesFilter(ac({ altFt: 20000 }), filter)).toBe(true);
    expect(matchesFilter(ac({ altFt: 9000 }), filter)).toBe(false);
    expect(matchesFilter(ac({ altFt: 31000 }), filter)).toBe(false);
    expect(matchesFilter(ac({ altFt: null }), filter)).toBe(false);
  });
});

describe('parseFilter', () => {
  it('returns an empty filter for missing or bad input', () => {
    expect(parseFilter(null)).toEqual(EMPTY_FILTER);
    expect(parseFilter('{oops')).toEqual(EMPTY_FILTER);
  });

  it('round-trips a valid filter', () => {
    const filter = { airline: 'CCA', type: '738', minAlt: 1000, maxAlt: 30000 };
    expect(parseFilter(JSON.stringify(filter))).toEqual(filter);
  });
});
