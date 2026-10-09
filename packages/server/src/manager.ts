import type { AircraftProvider } from '@flightradar/shared';
import { createAircraftSource, type AircraftSource } from './sources/index.js';

/** 运行时数据源管理：支持在设置页切换 provider，无需重启。 */
export class SourceManager {
  private current: AircraftSource;

  constructor(private id: AircraftProvider) {
    this.current = createAircraftSource(id);
  }

  get(): AircraftSource {
    return this.current;
  }

  getId(): AircraftProvider {
    return this.id;
  }

  set(id: AircraftProvider): void {
    const prev = this.current;
    this.id = id;
    this.current = createAircraftSource(id);
    if (prev !== this.current) void prev.dispose?.();
  }

  /** 释放当前数据源（关闭 Chromium 等）。 */
  async dispose(): Promise<void> {
    await this.current.dispose?.();
  }
}
