import type { AircraftProvider } from '@flightradar/shared';
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

export function listProviders(): ProviderInfo[] {
  return [
    {
      id: 'flightradar24',
      label: 'FlightRadar24（网页接口）',
      requiresKey: false,
      available: true,
      supportsAirportBoard: false,
      note: '网页接口仅提供部分飞机；配置 FR24_API_TOKEN 可获取完整数据。机场航班板与上游航迹暂不可用',
    },
    {
      id: 'flightaware',
      label: 'FlightAware（浏览器抓取）',
      requiresKey: false,
      available: true,
      supportsAirportBoard: true,
    },
    {
      id: 'adsb',
      label: 'ADS-B（adsb.lol 开放数据）',
      requiresKey: false,
      available: true,
      supportsAirportBoard: false,
      note: '开放 ADS-B 聚合数据，无需 key；覆盖取决于社区接收站',
    },
  ];
}

export function createAircraftSource(id: AircraftProvider): AircraftSource {
  if (id === 'flightradar24') return new FlightRadar24Source();
  if (id === 'adsb') return new AdsbSource();
  return new FlightAwareSource();
}

export type { AircraftSource } from './types.js';
export { UpstreamError } from './types.js';
export { setBrowserHostFactory, getBrowserHostFactory, type BrowserHost } from './browser-host.js';
