import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createAirspaceStore } from './index.js';

const dir = mkdtempSync(join(tmpdir(), 'meow-flight-airspace-'));

writeFileSync(join(dir, 'index.json'), JSON.stringify({ XX: [0, 0, 2, 2] }));
writeFileSync(
  join(dir, 'XX.geojson'),
  JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'Test CTR', type: 1 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0.5, 0.5],
              [1.5, 0.5],
              [1.5, 1.5],
              [0.5, 1.5],
              [0.5, 0.5],
            ],
          ],
        },
      },
    ],
  }),
);

const store = createAirspaceStore({ airspaceDir: dir });

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('createAirspaceStore', () => {
  it('loads the index and country files', () => {
    expect(store.hasData()).toBe(true);
    expect(store.countries()).toEqual(['XX']);
  });

  it('filters by bbox', () => {
    expect(store.inBBox({ lamin: 0, lomin: 0, lamax: 2, lomax: 2 }).features).toHaveLength(1);
    expect(store.inBBox({ lamin: 10, lomin: 10, lamax: 12, lomax: 12 }).features).toHaveLength(0);
  });
});
