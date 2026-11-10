import type { AircraftProvider } from './shared/index.js';
import type { AircraftSource, ProviderInfo, SourceFactory } from './sources/index.js';

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

/** 运行时数据源管理：支持切换 provider；非 ADS-B 源自动以 ADS-B 兜底。 */
export class SourceManager {
  private current: AircraftSource;
  private readonly factories = new Map<AircraftProvider, SourceFactory>();

  constructor(
    private id: AircraftProvider,
    factories: SourceFactory[],
  ) {
    for (const f of factories) this.factories.set(f.id, f);
    this.current = this.build(id);
  }

  private build(id: AircraftProvider): AircraftSource {
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`unknown aircraft provider: ${id}`);
    const primary = factory.create();
    const fallbackFactory = this.factories.get('adsb');
    if (id === 'adsb' || !fallbackFactory) return primary;
    return withFallback(primary, [fallbackFactory.create()]);
  }

  get(): AircraftSource {
    return this.current;
  }

  getId(): AircraftProvider {
    return this.id;
  }

  has(id: AircraftProvider): boolean {
    return this.factories.has(id);
  }

  providers(): ProviderInfo[] {
    return [...this.factories.values()].map((f) => f.info);
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
