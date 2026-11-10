import { createCore, type FlightCore } from 'meow-open-flight-core';
import { createAirspaceStore } from 'meow-open-flight-airspace';

/**
 * App 侧的 Core 单例。
 *
 * 延迟到 `startApiServer()` / `getCore()` 时才创建，确保 Electron 在
 * `main()` 里设置的 `FLIGHTRADAR_DATA_DIR` / `FLIGHTRADAR_AIRSPACE_DIR`
 * 和浏览器宿主工厂已经生效。
 */
let core: FlightCore | null = null;

export function getCore(): FlightCore {
  if (!core) {
    core = createCore({
      airspace: createAirspaceStore(),
    });
  }
  return core;
}

/** 以独立进程启动 API 服务（`npm start` 用）。port 传 0 时用随机空闲端口。 */
export function startApiServer(port?: number): ReturnType<FlightCore['start']> {
  return getCore().start(port);
}

/** 释放数据源（关闭 Chromium 等）。 */
export async function dispose(): Promise<void> {
  if (core) await core.dispose();
}
