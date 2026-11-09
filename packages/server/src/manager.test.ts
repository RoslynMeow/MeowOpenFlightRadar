import type { Aircraft, BBox } from '@flightradar/shared';
import { describe, expect, it } from 'vitest';
import { withFallback } from './manager';
import type { AircraftSource } from './sources/index';

const bbox: BBox = { lamin: 0, lomin: 0, lamax: 1, lomax: 1 };

function fake(id: string, ok: boolean): AircraftSource {
  return {
    id,
    async fetchAircraft() {
      if (!ok) throw new Error(`${id} failed`);
      return [{ icao24: id } as unknown as Aircraft];
    },
  };
}

describe('withFallback', () => {
  it('uses the primary when it succeeds', async () => {
    const source = withFallback(fake('primary', true), [fake('fallback', true)]);
    const list = await source.fetchAircraft(bbox);
    expect(list[0].icao24).toBe('primary');
    expect(source.id).toBe('primary');
  });

  it('falls back when the primary fails', async () => {
    const source = withFallback(fake('primary', false), [fake('fallback', true)]);
    const list = await source.fetchAircraft(bbox);
    expect(list[0].icao24).toBe('fallback');
    expect(source.id).toBe('fallback');
  });

  it('throws when every source fails', async () => {
    const source = withFallback(fake('primary', false), [fake('fallback', false)]);
    await expect(source.fetchAircraft(bbox)).rejects.toThrow('fallback failed');
  });
});
