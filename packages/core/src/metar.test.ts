import { describe, expect, it } from 'vitest';
import { decodeMetar, tafIssuedMillis } from './metar';

describe('decodeMetar', () => {
  it('decodes wind, temperature, pressure, clouds and visibility', () => {
    const m = decodeMetar('METAR ZBAA 090900Z 09005MPS 9999 SCT030 12/05 Q1015');
    expect(m.windDirDeg).toBe(90);
    expect(m.windSpeedKt).toBe(10);
    expect(m.tempC).toBe(12);
    expect(m.dewpointC).toBe(5);
    expect(m.altimHpa).toBe(1015);
    expect(m.visibility).toBe('10+');
    expect(m.clouds).toEqual([{ cover: 'SCT', baseFt: 3000 }]);
    expect(m.flightCategory).toBe('VFR');
  });

  it('detects low IFR conditions', () => {
    const m = decodeMetar('METAR XXXX 090900Z 00000KT 0800 FG BKN002 01/01 Q1000');
    expect(m.visibility).toBe('0.5');
    expect(m.weather).toBe('FG');
    expect(m.clouds).toEqual([{ cover: 'BKN', baseFt: 200 }]);
    expect(m.flightCategory).toBe('LIFR');
  });

  it('marks CAVOK as 10+ visibility', () => {
    const m = decodeMetar('METAR XXXX 090900Z 09005KT CAVOK 12/05 Q1015');
    expect(m.visibility).toBe('10+');
    expect(m.clouds).toEqual([{ cover: 'CAVOK', baseFt: null }]);
  });
});

describe('tafIssuedMillis', () => {
  it('reads the DDHHMMZ issue time', () => {
    const now = Date.UTC(2026, 10, 9, 12, 0);
    expect(tafIssuedMillis('TAF ZBAA 090500Z 0906/1012 09005KT CAVOK', now)).toBe(Date.UTC(2026, 10, 9, 5, 0));
  });

  it('returns null without an issue time', () => {
    expect(tafIssuedMillis('TAF ZBAA 0906/1012 09005KT', Date.now())).toBeNull();
  });
});
