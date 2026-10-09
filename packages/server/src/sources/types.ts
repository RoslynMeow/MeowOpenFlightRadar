import type { Aircraft, AirportBoard, BBox, TrackPoint, Weather } from '@flightradar/shared';

/** 上游错误（带 HTTP 状态码，便于限流退避）。 */
export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/** 飞机数据源统一接口：新增上游只要实现这个。 */
export interface AircraftSource {
  readonly id: string;
  fetchAircraft(bbox: BBox): Promise<Aircraft[]>;
  /** 可选：返回某架飞机的完整历史航迹（如 FlightAware）。没有则由服务端位置缓冲兜底。 */
  fetchTrack?(icao24: string): Promise<TrackPoint[]>;
  /** 可选：返回某机场的航班板（到达/出发/在途/计划）。 */
  fetchAirportInfo?(ident: string): Promise<AirportBoard[]>;
  /** 可选：返回某机场的天气（METAR / TAF）。 */
  fetchAirportWeather?(ident: string): Promise<Weather>;
  /** 可选：释放底层资源（如 FlightAware 的无头浏览器）。切换数据源时调用。 */
  dispose?(): Promise<void> | void;
}
