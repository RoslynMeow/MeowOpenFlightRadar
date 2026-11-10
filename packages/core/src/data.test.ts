import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createDataStore } from './data.js';

const dir = mkdtempSync(join(tmpdir(), 'meow-flight-data-'));

const airports = [
  {
    ident: 'ZXXX',
    type: 'small_airport',
    name: 'Peking Test Field',
    lat: 40,
    lon: -75,
    elevationFt: 100,
    isoCountry: 'US',
    municipality: 'Testville',
    iata: null,
    gpsCode: null,
    runways: [],
  },
  {
    ident: 'ZBAA',
    type: 'large_airport',
    name: 'Beijing Capital International Airport',
    lat: 40.08,
    lon: 116.6,
    elevationFt: 116,
    isoCountry: 'CN',
    municipality: 'Beijing',
    iata: 'PEK',
    gpsCode: 'ZBAA',
    runways: [
      {
        airportIdent: 'ZBAA',
        leIdent: '18L',
        heIdent: '36R',
        leLat: 40.07,
        leLon: 116.59,
        heLat: 40.1,
        heLon: 116.61,
        leHeading: 180,
        heHeading: 0,
        lengthFt: 12468,
        widthFt: 197,
        surface: 'ASP',
        closed: false,
      },
    ],
  },
];

writeFileSync(join(dir, 'airports.json'), JSON.stringify(airports));
writeFileSync(join(dir, 'navaids.json'), JSON.stringify([]));
writeFileSync(join(dir, 'reporting-points.json'), JSON.stringify([]));
writeFileSync(join(dir, 'fir.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [] }));

const data = createDataStore({ dataDir: dir });

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('createDataStore', () => {
  it('resolves ident and IATA, and ranks exact IATA first', () => {
    expect(data.airports.get('ZBAA')?.ident).toBe('ZBAA');
    expect(data.airports.get('pek')?.ident).toBe('ZBAA');
    expect(data.airports.search('PEK')[0]?.ident).toBe('ZBAA');
    expect(data.airports.search('Peking')[0]?.ident).toBe('ZXXX');
  });

  it('filters and sorts bbox results', () => {
    const items = data.airports.inBBox({ lamin: 39, lomin: 115, lamax: 41, lomax: 118 });
    expect(items.map((a) => a.ident)).toEqual(['ZBAA']);
    expect(items[0].municipality).toBe('Beijing');
  });

  it('returns runway GeoJSON', () => {
    const fc = data.airports.runwaysInBBox({ lamin: 39, lomin: 115, lamax: 41, lomax: 118 });
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.type).toBe('LineString');
  });

  it('reports empty datasets', () => {
    expect(data.navaids.hasData()).toBe(false);
    expect(data.reportingPoints.hasData()).toBe(false);
    expect(data.fir.hasData()).toBe(false);
    expect(data.manifest).toBeNull();
  });
});
