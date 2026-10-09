/**
 * 共享类型与纯函数工具（不依赖 DOM / Node 专有 API）。
 * 所有坐标统一为 WGS-84。
 */

/** 经纬度包围盒（度）。 */
export interface BBox {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}

/** 飞机类别（用于图标）。 */
export type AircraftKind = 'helicopter' | 'glider' | 'jet' | 'turboprop' | 'piston' | 'heavy';

/** 归一化后的飞机状态。高度=英尺，速度=节，升降率=英尺/分。 */
export interface Aircraft {
  /** 24 位 ICAO 地址（小写十六进制）。 */
  icao24: string;
  /** 呼号（已去空格）。 */
  callsign: string | null;
  lat: number;
  lon: number;
  /** 气压高度（英尺）；地面时为 null。 */
  altFt: number | null;
  /** 几何高度（英尺）。 */
  altGeomFt: number | null;
  /** 地速（节）。 */
  groundSpeedKt: number | null;
  /** 航迹角（度，真北）。 */
  trackDeg: number | null;
  /** 升降率（英尺/分）。 */
  verticalRateFpm: number | null;
  onGround: boolean;
  /** 注册国（当前数据源不提供，恒为 null）。 */
  originCountry: string | null;
  /** 发射器类别（如 A3）。 */
  category: string | null;
  /** 注册号（FlightAware 对通用航空提供；其余为 null）。 */
  registration: string | null;
  /** ICAO 机型代码（如 B738）。 */
  typeCode: string | null;
  /** 机型全称（如 A320 251NSL）。 */
  model: string | null;
  /** 飞机类别（用于地图图标）。 */
  kind: AircraftKind | null;
  /** 运营人 / 所属公司。 */
  operator: string | null;
  /** 起飞机场（来自数据源，可能为 null）。 */
  origin: { icao: string | null; iata: string | null } | null;
  /** 目的机场。 */
  destination: { icao: string | null; iata: string | null } | null;
  squawk: string | null;
  /** 距最后位置更新的秒数。 */
  seenPos: number | null;
  /** 数据来源 id。 */
  source: string;
  /**
   * 数据源是否明确允许对其位置做外推预测（默认 false：只按上报位置渲染，不预测）。
   * 仅当数据 JSON 明确给出该标志时才为 true。
   */
  predictable?: boolean;
}

export interface AircraftResult {
  /** 服务器生成结果的时间（Unix 毫秒）。 */
  time: number;
  provider: string;
  count: number;
  aircraft: Aircraft[];
}

/** 航迹点（时间 Unix 毫秒，高度英尺）。 */
export interface TrackPoint {
  t: number;
  lat: number;
  lon: number;
  altFt: number | null;
  trackDeg: number | null;
  onGround: boolean;
}

export interface TrackResult {
  icao24: string;
  provider: string;
  /** 航迹来源：`flightaware`=上游完整航迹；`buffer`=服务端累计的位置缓冲。 */
  origin: 'flightaware' | 'buffer';
  count: number;
  points: TrackPoint[];
}

export interface Runway {
  /** 跑道编号（机场 ident）。 */
  airportIdent: string;
  /** 两端设计编号，如 `18` / `36`。 */
  leIdent: string | null;
  heIdent: string | null;
  leLat: number;
  leLon: number;
  heLat: number;
  heLon: number;
  /** 真北磁方位角（度）。 */
  leHeading: number | null;
  heHeading: number | null;
  lengthFt: number | null;
  widthFt: number | null;
  surface: string | null;
  closed: boolean;
}

export interface Airport {
  ident: string;
  /** large_airport / medium_airport / small_airport ... */
  type: string;
  name: string;
  lat: number;
  lon: number;
  elevationFt: number | null;
  isoCountry: string;
  municipality: string | null;
  iata: string | null;
  gpsCode: string | null;
  runways: Runway[];
}

/** 叠加用的轻量机场摘要（不含跑道）。 */
export interface AirportSummary {
  ident: string;
  iata: string | null;
  name: string;
  type: string;
  lat: number;
  lon: number;
}

/** FlightAware 机场航班板里的一条航班。 */
export interface AirportFlight {
  /** 呼号 / 注册号。 */
  ident: string;
  /** 机型代码（如 B739）。 */
  type: string | null;
  /** 机型全称（如 Boeing 737 MAX 9）。 */
  typeDesc: string | null;
  /** 运营人（来自航班板 title）。 */
  operator: string | null;
  /** 对端机场：出发板=目的地，到达/在途板=出发地。 */
  other: {
    name: string | null;
    /** FlightAware 页面上显示的代码（通常为 IATA）。 */
    code: string | null;
    /** 本地机场库解析出的 ICAO 代码。 */
    icao: string | null;
    /** 本地机场库解析出的 IATA 代码。 */
    iata: string | null;
  } | null;
  /** 起飞时间（原文，含时区）。 */
  depart: string | null;
  /** 到达时间（原文，含时区）。 */
  arrive: string | null;
}

/** FlightAware 机场航班板（按 data-type 分组）。 */
export interface AirportBoard {
  /** arrivals / departures / enroute / scheduled。 */
  type: string;
  title: string;
  flights: AirportFlight[];
}

/** `/api/airports/:ident/flights` 响应。 */
export interface AirportInfoResult {
  ident: string;
  provider: string;
  time: number;
  boards: AirportBoard[];
}

/** 导航台（VOR / NDB / DME / TACAN）。 */
export interface Navaid {
  ident: string;
  name: string;
  type: string;
  /** 频率（kHz）。 */
  freqKhz: number | null;
  lat: number;
  lon: number;
  elevationFt: number | null;
  isoCountry: string;
  associatedAirport: string | null;
}

/** 云层。 */
export interface WeatherCloud {
  /** 云量代码：FEW / SCT / BKN / OVC / NSC / CAVOK … */
  cover: string;
  /** 云底高（英尺）。 */
  baseFt: number | null;
}

/** 一条 METAR / TAF 报文（含解析后的关键要素；TAF 的解析字段多为 null）。 */
export interface WeatherReport {
  kind: 'METAR' | 'TAF';
  /** 原始报文。 */
  raw: string;
  /** 观测 / 发布时间（Unix 毫秒）。 */
  at: number | null;
  tempC: number | null;
  dewpointC: number | null;
  /** 风向（度）；不定风时为 null。 */
  windDirDeg: number | null;
  /** 是否不定风（VRB）。 */
  windVar: boolean;
  windSpeedKt: number | null;
  windGustKt: number | null;
  /** 能见度（原文，单位 SM）。 */
  visibility: string | null;
  /** 修正海压（hPa）。 */
  altimHpa: number | null;
  /** 飞行类别：VFR / MVFR / IFR / LIFR。 */
  flightCategory: string | null;
  /** 现时天气现象（如 `-RA`）。 */
  weather: string | null;
  clouds: WeatherCloud[];
}

/** 机场 / 站点的天气（多条 METAR / TAF）。 */
export interface Weather {
  ident: string;
  /** 生成时间（Unix 毫秒）。 */
  time: number;
  /** 数据来源标识（如 flightaware / aviationweather.gov）。 */
  source?: string;
  /** 报文列表（按时间倒序）。 */
  reports: WeatherReport[];
}

/** 一条 NOTAM。 */
export interface Notam {
  id: string;
  /** 类型：NOTAMN / NOTAMR / NOTAMC。 */
  kind: string | null;
  /** 生效 / 失效时间（Unix 毫秒，可能为 null）。 */
  from: number | null;
  to: number | null;
  /** 原文。 */
  text: string;
}

/** 管制分区 / 机场的 NOTAM 查询结果。 */
export interface NotamResult {
  /** 查询目标（FIR id / 机场 ident / 空域名称）。 */
  target: string;
  /** 是否已接入 NOTAM 数据源。 */
  available: boolean;
  /** 未接入或出错时的说明。 */
  message?: string;
  notams: Notam[];
  time: number;
}

export type AircraftProvider = 'flightaware';

export const AIRCRAFT_PROVIDERS: readonly AircraftProvider[] = ['flightaware'];

export function isAircraftProvider(v: unknown): v is AircraftProvider {
  return typeof v === 'string' && (AIRCRAFT_PROVIDERS as readonly string[]).includes(v);
}

/** 校验任意值是否为合法 BBox（经纬度范围 + 顺序）。
 * `lomax` 允许超过 180（跨日期变更线的视图），最多到 `lomin + 360`。 */
export function isBBox(v: unknown): v is BBox {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  const nums = [b.lamin, b.lomin, b.lamax, b.lomax];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  const { lamin, lomin, lamax, lomax } = b as unknown as BBox;
  return (
    lamin >= -90 &&
    lamax <= 90 &&
    lamin <= lamax &&
    lomin >= -180 &&
    lomin <= 180 &&
    lomax >= lomin &&
    lomax <= lomin + 360
  );
}

/**
 * 把可能跨 ±180 的 bbox 拆成若干标准 bbox（都落在 [-180,180] 内），供服务端查询上游/静态数据。
 * 这只影响后端取数，客户端渲染始终是连续的一整块，不会在日期变更线/本初子午线处被切断。
 */
export function splitBBox(b: BBox): BBox[] {
  const lat = { lamin: b.lamin, lamax: b.lamax };
  let lonMin = b.lomin;
  let lonMax = b.lomax;
  if (lonMax - lonMin >= 360) return [{ ...lat, lomin: -180, lomax: 180 }];
  while (lonMin < -180) {
    lonMin += 360;
    lonMax += 360;
  }
  while (lonMin >= 180) {
    lonMin -= 360;
    lonMax -= 360;
  }
  if (lonMax <= 180) return [{ ...lat, lomin: lonMin, lomax: lonMax }];
  return [
    { ...lat, lomin: lonMin, lomax: 180 },
    { ...lat, lomin: -180, lomax: lonMax - 360 },
  ];
}

/** 解析 `lamin,lomin,lamax,lomax` 形式的 bbox 字符串。 */
export function parseBBoxString(s: string | null | undefined): BBox | null {
  if (!s) return null;
  const parts = s.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const bbox: BBox = { lamin: parts[0], lomin: parts[1], lamax: parts[2], lomax: parts[3] };
  return isBBox(bbox) ? bbox : null;
}

export function bboxToString(b: BBox): string {
  return [b.lamin, b.lomin, b.lamax, b.lomax].map((n) => n.toFixed(4)).join(',');
}

export function bboxCenter(b: BBox): { lat: number; lng: number } {
  return { lat: (b.lamin + b.lamax) / 2, lng: (b.lomin + b.lomax) / 2 };
}

const EARTH_RADIUS_NM = 3440.065;

/** 到中心点的半径（海里），取包围盒对角线一半。 */
export function bboxRadiusNm(b: BBox): number {
  const c = bboxCenter(b);
  const dLat = (b.lamax - c.lat) * 60; // 1 度纬度 ≈ 60 海里
  const dLon = (b.lomax - c.lng) * 60 * Math.cos((c.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/** 点是否落在包围盒内（含边界）。 */
export function inBBox(lat: number, lon: number, b: BBox): boolean {
  return lat >= b.lamin && lat <= b.lamax && lon >= b.lomin && lon <= b.lomax;
}

/** 确保 bbox 面积足够大（避免上游 point 查询半径过小）。 */
export function expandBBox(b: BBox, minSpanDeg = 0.2): BBox {
  const midLat = (b.lamin + b.lamax) / 2;
  const midLon = (b.lomin + b.lomax) / 2;
  const halfLat = Math.max((b.lamax - b.lamin) / 2, minSpanDeg / 2);
  const halfLon = Math.max((b.lomax - b.lomin) / 2, minSpanDeg / 2);
  return {
    lamin: Math.max(-90, midLat - halfLat),
    lamax: Math.min(90, midLat + halfLat),
    lomin: Math.max(-180, midLon - halfLon),
    lomax: Math.min(180, midLon + halfLon),
  };
}

export { EARTH_RADIUS_NM };
