import type { AircraftProvider } from '@flightradar/shared';
import { AdsbSource } from './sources/adsb.js';
import { createAircraftSource, type AircraftSource } from './sources/index.js';

/** Wrap a primary source with automatic fallbacks; `id` reports the source that last answered. */
export function withFallback(primary: AircraftSource, fallbacks: AircraftSource[]): AircraftSource {
  let lastId = primary.id;
  const wrapped: AircraftSource = {
    get id() {
      return lastId;
    },
    async fetchAircraft(bbox) {
      let lastError: unknown;
      for (const source of [primary, ...fallbacks]) {
        try {
          const list = await source.fetchAircraft(bbox);
          lastId = source.id;
          return list;
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError;
    },
    async dispose() {
      await primary.dispose?.();
      for (const fallback of fallbacks) await fallback.dispose?.();
    },
  };

  const fetchTrack = primary.fetchTrack;
  if (fetchTrack) wrapped.fetchTrack = (icao24) => fetchTrack(icao24);
  const fetchAirportInfo = primary.fetchAirportInfo;
  if (fetchAirportInfo) wrapped.fetchAirportInfo = (ident) => fetchAirportInfo(ident);
  const fetchAirportWeather = primary.fetchAirportWeather;
  if (fetchAirportWeather) wrapped.fetchAirportWeather = (ident) => fetchAirportWeather(ident);

  return wrapped;
}

/** 运行时数据源管理：支持在设置页切换 provider，无需重启；非 ADS-B 源自动以 ADS-B 兜底。 */
export class SourceManager {
  private current: AircraftSource;

  constructor(private id: AircraftProvider) {
    this.current = this.build(id);
  }

  private build(id: AircraftProvider): AircraftSource {
    const primary = createAircraftSource(id);
    return id === 'adsb' ? primary : withFallback(primary, [new AdsbSource()]);
  }

  get(): AircraftSource {
    return this.current;
  }

  getId(): AircraftProvider {
    return this.id;
  }

  set(id: AircraftProvider): void {
    const prev = this.current;
    this.id = id;
    this.current = this.build(id);
    if (prev !== this.current) void prev.dispose?.();
  }

  /** 释放当前数据源（关闭 Chromium 等）。 */
  async dispose(): Promise<void> {
    await this.current.dispose?.();
  }
}
