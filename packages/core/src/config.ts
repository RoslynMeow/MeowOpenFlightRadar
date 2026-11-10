import { isAircraftProvider, type AircraftProvider, type AirspaceProvider } from './shared/index.js';
import type { SourceFactory } from './sources/index.js';
import { defaultDataDir } from './paths.js';

/** 创建 Core 时的可选项；未提供的字段回退到环境变量或默认值。 */
export interface CoreOptions {
  /** 静态数据目录；默认 `FLIGHTRADAR_DATA_DIR` 或包内 `data/`。 */
  dataDir?: string;
  /** 初始实时飞机数据源。 */
  provider?: AircraftProvider;
  /** 后台轮询间隔（毫秒）。 */
  pollIntervalMs?: number;
  /** `/api/aircraft` 的 TTL 缓存（毫秒）。 */
  cacheTtlMs?: number;
  /** CORS 允许的来源，默认 `*`。 */
  webOrigin?: string;
  /** SkyLink NOTAM API key；不传则 NOTAM 不可用。 */
  skylinkApiKey?: string;
  /** `core.start()` 的默认端口。 */
  port?: number;
  /** 空域数据提供者；不传则 `/api/airspace` 返回空集合。 */
  airspace?: AirspaceProvider;
  /** 自定义数据源工厂；默认 FlightAware / FlightRadar24 / ADS-B。 */
  sourceFactories?: SourceFactory[];
}

export interface CoreConfig {
  dataDir: string;
  port: number;
  provider: AircraftProvider;
  pollIntervalMs: number;
  cacheTtlMs: number;
  webOrigin: string;
  skylinkApiKey: string;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function providerFromEnv(): AircraftProvider {
  const raw = process.env.AIRCRAFT_PROVIDER;
  if (!raw) return 'flightradar24';
  if (!isAircraftProvider(raw)) {
    console.warn(`[config] unknown AIRCRAFT_PROVIDER="${raw}", falling back to "flightradar24"`);
    return 'flightradar24';
  }
  return raw;
}

/** 生成一份不可变的 Core 配置；不会在模块加载时读取环境变量。 */
export function createConfig(options: CoreOptions = {}): CoreConfig {
  return {
    dataDir: options.dataDir ?? defaultDataDir(),
    port: options.port ?? intEnv('PORT', 8787),
    provider: options.provider ?? providerFromEnv(),
    pollIntervalMs: options.pollIntervalMs ?? intEnv('POLL_INTERVAL_MS', 2000),
    cacheTtlMs: options.cacheTtlMs ?? intEnv('CACHE_TTL_MS', 4000),
    webOrigin: options.webOrigin ?? process.env.WEB_ORIGIN ?? '*',
    skylinkApiKey: options.skylinkApiKey ?? process.env.SKYLINK_API_KEY?.trim() ?? '',
  };
}
