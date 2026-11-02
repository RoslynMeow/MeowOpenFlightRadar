import type { AircraftProvider } from '@flightradar/shared';
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
      label: 'FlightRadar24（网页抓取）',
      requiresKey: false,
      available: true,
      supportsAirportBoard: false,
      note: '网页接口仅提供部分飞机；配置 FR24_API_TOKEN 可获取完整数据。机场航班板与上游航迹暂不可用',
    },
    {
      id: 'flightaware',
      label: 'FlightAware（网页抓取）',
      requiresKey: false,
      available: true,
      supportsAirportBoard: true,
    },
  ];
}

export function createAircraftSource(id: AircraftProvider): AircraftSource {
  return id === 'flightradar24' ? new FlightRadar24Source() : new FlightAwareSource();
}

export type { AircraftSource } from './types.js';
export { UpstreamError } from './types.js';
export { setBrowserHostFactory, getBrowserHostFactory, type BrowserHost } from './browser-host.js';
