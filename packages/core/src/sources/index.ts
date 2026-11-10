import type { AircraftProvider, Airport } from '../shared/index.js';
import { createDataStore, type DataStore } from '../data.js';
import { AdsbSource } from './adsb.js';
import { FlightAwareSource } from './flightaware.js';
import { FlightRadar24Source } from './flightradar24.js';
import type { AircraftSource } from './types.js';

export interface ProviderInfo {
  id: AircraftProvider;
  label: string;
  requiresKey: boolean;
  available: boolean;
  supportsAirportBoard: boolean;
  note?: string;
}

/** 数据源工厂：Core 只依赖接口，具体实现可由使用方替换或追加。 */
export interface SourceFactory {
  readonly id: AircraftProvider;
  readonly info: ProviderInfo;
  create(): AircraftSource;
}

/** 默认的三种数据源：FlightAware 抓取、FlightRadar24、ADS-B。 */
export function createDefaultSourceFactories(data: DataStore = createDataStore()): SourceFactory[] {
  const getAirport = (ident: string): Airport | null => data.airports.get(ident);

  return [
    {
      id: 'flightradar24',
      info: {
        id: 'flightradar24',
        label: 'FlightRadar24（网页接口）',
        requiresKey: false,
        available: true,
        supportsAirportBoard: false,
        note: '网页接口仅提供部分飞机；配置 FR24_API_TOKEN 可获取完整数据。机场航班板与上游航迹暂不可用',
      },
      create: () => new FlightRadar24Source({ getAirport }),
    },
    {
      id: 'flightaware',
      info: {
        id: 'flightaware',
        label: 'FlightAware（浏览器抓取）',
        requiresKey: false,
        available: true,
        supportsAirportBoard: true,
      },
      create: () => new FlightAwareSource({ getAirport }),
    },
    {
      id: 'adsb',
      info: {
        id: 'adsb',
        label: 'ADS-B（adsb.lol 开放数据）',
        requiresKey: false,
        available: true,
        supportsAirportBoard: false,
        note: '开放 ADS-B 聚合数据，无需 key；覆盖取决于社区接收站',
      },
      create: () => new AdsbSource(),
    },
  ];
}

export function listProviders(factories: SourceFactory[] = createDefaultSourceFactories()): ProviderInfo[] {
  return factories.map((f) => f.info);
}

export type { AircraftSource } from './types.js';
export { UpstreamError } from './types.js';
export { AdsbSource } from './adsb.js';
export { FlightAwareSource, type FlightAwareDeps } from './flightaware.js';
export { FlightRadar24Source, type FlightRadar24Deps } from './flightradar24.js';
export { setBrowserHostFactory, getBrowserHostFactory, type BrowserHost } from './browser-host.js';
