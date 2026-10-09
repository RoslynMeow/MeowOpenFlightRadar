import type { AircraftProvider } from '@flightradar/shared';
import { FlightAwareSource } from './flightaware.js';
import type { AircraftSource } from './types.js';

export interface ProviderInfo {
  id: AircraftProvider;
  label: string;
  requiresKey: boolean;
  available: boolean;
  note?: string;
}

export function listProviders(): ProviderInfo[] {
  return [
    {
      id: 'flightaware',
      label: 'FlightAware（数据致谢）',
      requiresKey: false,
      available: true,
    },
  ];
}

export function createAircraftSource(_id: AircraftProvider): AircraftSource {
  return new FlightAwareSource();
}

export type { AircraftSource } from './types.js';
export { UpstreamError } from './types.js';
export { setBrowserHostFactory, getBrowserHostFactory, type BrowserHost } from './browser-host.js';
