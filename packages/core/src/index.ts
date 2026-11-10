/**
 * MeowOpenFlightCore
 *
 * 航空静态数据（机场 / 跑道 / 导航台 / VRP / FIR）、实时飞机数据源、
 * 后台轮询 + SSE、天气 / NOTAM / SkyVector 代理，以及一套 Hono 路由。
 */

export { createCore, type FlightCore } from './app.js';
export { createConfig, type CoreConfig, type CoreOptions } from './config.js';
export { defaultDataDir } from './paths.js';

export {
  createDataStore,
  loadManifest,
  type DataStore,
  type CreateDataStoreOptions,
  type DataManifest,
  type DatasetInfo,
} from './data.js';
export { createAirportStore, type AirportStore } from './airports.js';
export { createNavaidStore, type NavaidStore } from './navaids.js';
export { createReportingPointStore, type ReportingPointStore } from './reporting-points.js';
export { createFirStore, type FirStore } from './fir.js';

export {
  createDefaultSourceFactories,
  listProviders,
  setBrowserHostFactory,
  getBrowserHostFactory,
  type SourceFactory,
  type ProviderInfo,
  type BrowserHost,
  type AircraftSource,
  UpstreamError,
} from './sources/index.js';
export { AdsbSource } from './sources/adsb.js';
export { FlightAwareSource, type FlightAwareDeps } from './sources/flightaware.js';
export { FlightRadar24Source, type FlightRadar24Deps } from './sources/flightradar24.js';
export { kindForTypeCode } from './sources/kind.js';

export { SourceManager, withFallback } from './manager.js';
export { AircraftPoller } from './poller.js';
export { TrackHistory } from './history.js';
export { TTLCache } from './cache.js';

export { getWeather } from './weather.js';
export { createNotamService, type NotamService } from './notam.js';
export { decodeMetar, tafIssuedMillis, type DecodedMetar } from './metar.js';
export {
  SKYVECTOR_CHARTS,
  SKYVECTOR_PROTOIDS,
  skyvectorGridSize,
  skyvectorMeta,
  skyvectorTile,
} from './skyvector.js';

export * from './shared/index.js';
export * from './coords/index.js';
