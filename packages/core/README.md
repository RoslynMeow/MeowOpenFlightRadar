# MeowOpenFlightCore

> npm package: [`meow-open-flight-core`](https://www.npmjs.com/package/meow-open-flight-core)

MeowOpenFlightCore 是 [MeowOpenFlightRadar](https://github.com/RoslynMeow/MeowOpenFlightRadar) 的航空数据与 API 核心：

- 静态航空数据：机场 / 跑道、导航台、VFR 报告点、FIR / UIR
- 实时飞机数据源：FlightAware（浏览器抓取）、FlightRadar24、ADS-B（adsb.lol）
- 后台轮询 + 多客户端 SSE 共享缓存
- 航迹缓冲、天气（METAR / TAF）、NOTAM、SkyVector 航图代理
- 一套现成的 Hono 路由

## 安装

```bash
npm i meow-open-flight-core
```

可选：使用 FlightAware 抓取时需要浏览器。

```bash
npm i playwright-core
npx playwright-core install chromium
```

## 快速开始

```ts
import { createCore } from 'meow-open-flight-core';

const core = createCore();

// core.app 是 Hono 实例，可直接挂到自己的服务
const server = core.start(8787);

// 关闭时释放浏览器等资源
process.on('SIGINT', async () => {
  server.close();
  await core.dispose();
});
```

挂到已有的 Hono 服务：

```ts
import { Hono } from 'hono';
import { createCore } from 'meow-open-flight-core';

const core = createCore();
const app = new Hono();
app.route('/', core.app);
```

## 配置

```ts
const core = createCore({
  dataDir: '/path/to/data',
  provider: 'flightradar24',       // 'flightaware' | 'flightradar24' | 'adsb'
  pollIntervalMs: 2000,
  cacheTtlMs: 4000,
  webOrigin: '*',
  skylinkApiKey: process.env.SKYLINK_API_KEY,
  airspace: airspaceStore,          // 来自 meow-open-flight-airspace
  sourceFactories: [...],           // 自定义/追加数据源
});
```

环境变量（都可被显式参数覆盖）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `FLIGHTRADAR_DATA_DIR` | 包内 `data/` | 静态数据目录 |
| `AIRCRAFT_PROVIDER` | `flightradar24` | 初始数据源 |
| `POLL_INTERVAL_MS` | `2000` | 轮询间隔 |
| `CACHE_TTL_MS` | `4000` | 飞机缓存 TTL |
| `WEB_ORIGIN` | `*` | CORS 来源 |
| `SKYLINK_API_KEY` | 空 | NOTAM 数据源 |
| `FR24_API_TOKEN` | 空 | FlightRadar24 官方 API |

## 主要 API

### Core

```ts
interface FlightCore {
  app: Hono;
  config: CoreConfig;
  data: DataStore;
  manager: SourceManager;
  poller: AircraftPoller;
  history: TrackHistory;
  notam: NotamService;
  airspace: AirspaceProvider | null;
  start(port?: number): ServerType;
  dispose(): Promise<void>;
  refresh(): void;
  status(): UpstreamStatus;
}
```

### 静态数据

```ts
const data = createDataStore({ dataDir: '/path/to/data' });

data.airports.get('ZBAA');                 // ident / IATA / GPS code
data.airports.search('PEK', 20);           // 精确 > 前缀 > IATA > ident > 名称 > 城市
data.airports.inBBox(bbox, 1200);
data.airports.runwaysInBBox(bbox, 4000);
data.airports.runwaysGeoJSON(airport);

data.navaids.inBBox(bbox, 2000);
data.reportingPoints.inBBox(bbox, 4000);
data.fir.inBBox(bbox, 1500);

data.manifest;                             // manifest.json 内容
```

### 数据源

```ts
import {
  AdsbSource,
  FlightAwareSource,
  FlightRadar24Source,
  createDefaultSourceFactories,
  SourceManager,
  withFallback,
} from 'meow-open-flight-core';

const factories = createDefaultSourceFactories(data);
const manager = new SourceManager('flightradar24', factories);
await manager.get().fetchAircraft(bbox);
manager.set('adsb');
```

### 数据源接口

```ts
interface AircraftSource {
  readonly id: string;
  fetchAircraft(bbox: BBox): Promise<Aircraft[]>;
  fetchTrack?(icao24: string): Promise<TrackPoint[]>;
  fetchAirportInfo?(ident: string): Promise<AirportBoard[]>;
  fetchAirportWeather?(ident: string): Promise<Weather>;
  dispose?(): Promise<void> | void;
}
```

### 其他模块

```ts
import {
  AircraftPoller,
  TrackHistory,
  TTLCache,
  getWeather,
  createNotamService,
  decodeMetar,
  tafIssuedMillis,
  skyvectorMeta,
  skyvectorTile,
  SKYVECTOR_CHARTS,
} from 'meow-open-flight-core';
```

### 共享类型与 BBox 工具（浏览器安全子路径）

```ts
import type { Aircraft, Airport, Runway, Navaid, ReportingPoint, BBox } from 'meow-open-flight-core/shared';
import { isBBox, splitBBox, parseBBoxString, inBBox } from 'meow-open-flight-core/shared';
```

### 坐标解析 / 格式化（浏览器安全子路径）

底层复用 [`meow-tile-kit-core`](https://www.npmjs.com/package/meow-tile-kit-core) 的 16 种格式，并补上 `imw` 自动识别、官方 Geohash-36 和格子 bbox。

```ts
import {
  parseCoordinate,
  parseCoordinateToBBox,
  formatCoordinate,
  bboxFromRadius,
  bboxFromRadiusSplit,
} from 'meow-open-flight-core/coords';

parseCoordinate('wx4g0bm');
// { lat: 39.9044, lon: 116.4077, format: 'geohash', bbox: {...}, precisionM: 152.9 }

parseCoordinate('50N 449345 4417292');
parseCoordinate('QJ9A TZT3');
parseCoordinate('116.4074, 39.9042', { order: 'lonlat' });

formatCoordinate(39.9042, 116.4074, 'geohash'); // 'wx4g0bm'

bboxFromRadius(39.9042, 116.4074, { radius: 10 }); // 默认 km
bboxFromRadius(39.9042, 116.4074, { radius: 10, unit: 'nm' });
bboxFromRadiusSplit(0, 179.9, { radius: 50 }); // 跨日期变更线返回两个 bbox
```

支持：

```text
decimal / dm / dms
geohash / geohash36 / geohash36-official
georef / utm / mgrs
csquares / imw / marsden / qdgc / wmo
nac / olc / mapcode
iso6709 / geouri（额外支持）
```

官方 Mapcode 需要地区代码和可选 peer `mapcode-ts`：

```ts
import { officialMapcode } from 'meow-open-flight-core/coords/mapcode-official';

parseCoordinate('TQ37.JS9K', {
  mapcodeTerritory: 'CN',
  officialMapcode,
});
```

不传 `mapcodeTerritory` 时使用内置的全局 Mapcode 解码器（和 `meow-tile-kit-core` 一致）。


## HTTP 路由

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查与数据就绪状态 |
| GET | `/api/settings` | 当前数据源 + 可用数据源 |
| PUT | `/api/settings` | 切换数据源 `{ provider }` |
| POST | `/api/refresh` | 清除退避并立即刷新 |
| GET | `/api/aircraft?bbox=...` | 实时飞机 |
| GET | `/api/airports?q=` / `?bbox=` | 机场搜索 / 视野内机场 |
| GET | `/api/airports/:ident` | 机场详情（含跑道） |
| GET | `/api/airports/:ident/runways.geojson` | 跑道 GeoJSON |
| GET | `/api/airports/:ident/flights` | 机场航班板（需支持的上游） |
| GET | `/api/navaids?bbox=` | 导航台 |
| GET | `/api/reporting-points?bbox=` | VFR 报告点 |
| GET | `/api/airspace?bbox=` | 空域 GeoJSON（需注入 airspace） |
| GET | `/api/fir?bbox=` | FIR / UIR |
| GET | `/api/runways?bbox=` | 跑道 GeoJSON |
| GET | `/api/weather/:ident` | METAR / TAF |
| GET | `/api/notam?q=` | NOTAM |
| GET | `/api/tracks/:icao24` | 航迹 |
| GET | `/event/aircraft?sid=&bbox=` | SSE 实时推流 |
| GET | `/api/viewport?sid=&bbox=` | 更新 SSE 视野 |
| GET | `/api/skyvector/meta` | 航图周期信息 |
| GET | `/api/skyvector/raw/:protoid/:scale/:x/:y` | 航图瓦片 |

## 数据

| 数据集 | 来源 | 许可 |
| --- | --- | --- |
| 机场 / 跑道 / 导航台 | OurAirports | Public Domain |
| VFR 报告点 | openAIP | CC BY-NC 4.0 |
| FIR / UIR | VATSIM / VATSpy | CC BY-SA 4.0 |

空域数据不在此包内，安装 [`meow-open-flight-airspace`](https://www.npmjs.com/package/meow-open-flight-airspace)：

```ts
import { createAirspaceStore } from 'meow-open-flight-airspace';
const core = createCore({ airspace: createAirspaceStore() });
```

## 声明

- 代码：MIT。
- 数据：按各自许可，详见 `NOTICE.md` 与 `DATA-LICENSES.md`。
- FlightAware 与 FlightRadar24 均非官方接入，可能违反其服务条款，仅供个人学习与测试，风险自负。
- SkyVector World 航图为 Jeppesen 授权数据，仅供个人测试，请勿公开分发。
