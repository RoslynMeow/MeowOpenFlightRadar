import { isAircraftProvider, type AircraftProvider } from '@flightradar/shared';

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const providerEnv = process.env.AIRCRAFT_PROVIDER;
if (providerEnv && !isAircraftProvider(providerEnv)) {
  console.warn(`[config] unknown AIRCRAFT_PROVIDER="${providerEnv}", falling back to "flightaware"`);
}

export const config = {
  port: intEnv('PORT', 8787),
  provider: (isAircraftProvider(providerEnv) ? providerEnv : 'flightaware') as AircraftProvider,
  pollIntervalMs: intEnv('POLL_INTERVAL_MS', 2000),
  cacheTtlMs: intEnv('CACHE_TTL_MS', 4000),
  webOrigin: process.env.WEB_ORIGIN ?? '*',
  /** SkyLink NOTAM API key（可选，不配则 NOTAM 源为占位）。 */
  skylinkApiKey: process.env.SKYLINK_API_KEY?.trim() ?? '',
};
