import { splitBBox, type Aircraft, type AircraftResult, type BBox } from '@flightradar/shared';
import type { AircraftSource } from './sources/index.js';
import { UpstreamError } from './sources/types.js';
import type { TrackHistory } from './history.js';

function roundKey(bbox: BBox): string {
  return [bbox.lamin, bbox.lomin, bbox.lamax, bbox.lomax].map((n) => n.toFixed(2)).join(',');
}

interface Sub {
  bbox: BBox;
  refs: number;
}

/**
 * 后台轮询器：对每个被订阅的视野 bbox 独立刷新上游数据并缓存。
 * SSE 客户端只读缓存（毫秒级），不再受上游响应延迟影响；相同 bbox 的多个客户端共享一次上游请求。
 */
export class AircraftPoller {
  private subs = new Map<string, Sub>();
  private latest = new Map<string, AircraftResult>();
  private fetching = new Set<string>();
  /** 上游限流/出错后的退避截止时间（ms）。 */
  private backoffUntil = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly getSource: () => AircraftSource,
    private readonly history: TrackHistory,
    private readonly intervalMs: number,
  ) {}

  /** 切换数据源后清空缓存，下一轮用新源重新拉取。 */
  clear(): void {
    this.latest.clear();
    this.backoffUntil.clear();
  }

  subscribe(bbox: BBox): string {
    const key = roundKey(bbox);
    const s = this.subs.get(key);
    if (s) {
      s.refs++;
    } else {
      this.subs.set(key, { bbox, refs: 1 });
      void this.fetch(key);
    }
    this.ensureTimer();
    return key;
  }

  unsubscribe(key: string): void {
    const s = this.subs.get(key);
    if (!s) return;
    s.refs--;
    if (s.refs <= 0) this.subs.delete(key);
    if (this.subs.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getLatest(key: string): AircraftResult | undefined {
    return this.latest.get(key);
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const key of this.subs.keys()) void this.fetch(key);
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  private async fetch(key: string): Promise<void> {
    if (this.fetching.has(key)) return;
    const backoff = this.backoffUntil.get(key);
    if (backoff && Date.now() < backoff) return;
    const s = this.subs.get(key);
    if (!s) return;
    this.fetching.add(key);
    try {
      const source = this.getSource();
      // 跨 ±180 的视野按需拆分后合并；对客户端仍是一整块连续数据。
      const lists = await Promise.all(splitBBox(s.bbox).map((p) => source.fetchAircraft(p)));
      const seen = new Set<string>();
      const list: Aircraft[] = [];
      for (const arr of lists) {
        for (const a of arr) {
          if (seen.has(a.icao24)) continue;
          seen.add(a.icao24);
          list.push(a);
        }
      }
      this.history.record(list);
      this.latest.set(key, {
        time: Date.now(),
        provider: source.id,
        count: list.length,
        aircraft: list,
      });
      this.backoffUntil.delete(key);
    } catch (e) {
      // 429 限流退避久一点，其它错误短暂退避
      const status = e instanceof UpstreamError ? e.status : 0;
      const delay = status === 429 ? 12000 : 5000;
      this.backoffUntil.set(key, Date.now() + delay);
    } finally {
      this.fetching.delete(key);
    }
  }
}
