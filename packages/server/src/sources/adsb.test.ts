import { describe, expect, it } from 'vitest';
import { normalizeAdsbRow } from './adsb';

const bbox = { lamin: 30, lomin: 100, lamax: 50, lomax: 130 };

describe('normalizeAdsbRow', () => {
  it('maps a normal row', () => {
    const ac = normalizeAdsbRow(
      {
        hex: 'ABC123',
        flight: 'CA123 ',
        lat: 40,
        lon: 116,
        alt_baro: 26000,
        alt_geom: 26400,
        gs: 431.8,
        track: 227.6,
        baro_rate: 1856,
        t: 'B738',
        r: 'B-1490',
        squawk: '5153',
        category: 'A3',
        seen_pos: 0.1,
      },
      bbox,
    );
    expect(ac).toMatchObject({
      icao24: 'abc123',
      callsign: 'CA123',
      lat: 40,
      lon: 116,
      altFt: 26000,
      groundSpeedKt: 431.8,
      trackDeg: 227.6,
      verticalRateFpm: 1856,
      registration: 'B-1490',
      typeCode: 'B738',
      squawk: '5153',
      source: 'adsb',
    });
  });

  it('handles ground rows', () => {
    expect(normalizeAdsbRow({ hex: 'a', lat: 40, lon: 116, alt_baro: 'ground' }, bbox)?.onGround).toBe(true);
  });

  it('drops out-of-bbox rows', () => {
    expect(normalizeAdsbRow({ hex: 'a', lat: 0, lon: 0 }, bbox)).toBeNull();
  });
});
