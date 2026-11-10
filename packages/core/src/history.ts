import type { Aircraft, TrackPoint } from './shared/index.js';

const MAX_POINTS = 4000;
const MAX_AIRCRAFT = 3000;
const MAX_AGE_MS = 90 * 60 * 1000;

/**
 * 服务端累计的飞机位置缓冲（provider 无关）。
 * 每次向上游拉取后记录位置；点击飞机时可回放「服务端看到过的」航迹。
 * Map 的插入顺序用作最近使用淘汰（LRU）。
 */
export class TrackHistory {
  private map = new Map<string, TrackPoint[]>();

  record(list: Aircraft[], now = Date.now()): void {
    const cutoff = now - MAX_AGE_MS;
    for (const ac of list) {
      let pts = this.map.get(ac.icao24);
      if (pts) {
        this.map.delete(ac.icao24); // 触碰 LRU
      } else {
        if (this.map.size >= MAX_AIRCRAFT) {
          const oldest = this.map.keys().next().value;
          if (oldest !== undefined) this.map.delete(oldest);
        }
        pts = [];
      }
      this.map.set(ac.icao24, pts);

      // 丢弃超过保留期的点，避免飞机离开视野后内存持续增长。
      if (pts.length && pts[0].t < cutoff) {
        let drop = 0;
        while (drop < pts.length && pts[drop].t < cutoff) drop++;
        if (drop) pts.splice(0, drop);
      }

      const last = pts[pts.length - 1];
      if (last && last.lat === ac.lat && last.lon === ac.lon) {
        last.t = now;
        continue;
      }
      pts.push({
        t: now,
        lat: ac.lat,
        lon: ac.lon,
        altFt: ac.altFt,
        trackDeg: ac.trackDeg,
        onGround: ac.onGround,
      });
      if (pts.length > MAX_POINTS) pts.splice(0, pts.length - MAX_POINTS);
    }
  }

  get(icao24: string): TrackPoint[] {
    const pts = this.map.get(icao24);
    if (!pts) return [];
    const cutoff = Date.now() - MAX_AGE_MS;
    const out = pts.filter((p) => p.t >= cutoff);
    if (out.length !== pts.length) {
      if (out.length) this.map.set(icao24, out);
      else this.map.delete(icao24);
    }
    return out;
  }
}
