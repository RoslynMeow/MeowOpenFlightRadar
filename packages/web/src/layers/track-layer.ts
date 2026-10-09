import L from 'leaflet';
import type { TrackPoint } from '@flightradar/shared';
import type { MeowMap } from 'meow-tile-kit';
import { copyOffsets } from '../wrap';

/** 单架飞机的历史航迹折线（WGS-84 存储，随图源切换重投影重绘）。 */
export class TrackLayer {
  private readonly app: MeowMap;
  private points: TrackPoint[] = [];
  private lines: L.Polyline[] = [];
  private halos: L.Polyline[] = [];
  private starts: L.CircleMarker[] = [];
  /** 实时端点：飞机当前显示位置（随插值移动），保证航迹末端贴着飞机。 */
  private live: { lat: number; lon: number } | null = null;

  constructor(app: MeowMap) {
    this.app = app;
  }

  setPoints(points: TrackPoint[]): void {
    this.points = points.slice();
    this.draw();
  }

  /** 追加一个实时位置点（与末点重合则忽略），让航迹随推流生长。 */
  append(p: TrackPoint): void {
    const last = this.points[this.points.length - 1];
    if (last && Math.abs(last.lat - p.lat) < 1e-5 && Math.abs(last.lon - p.lon) < 1e-5) return;
    this.points.push(p);
    this.draw();
  }

  /** 更新实时端点（飞机的显示位置）。 */
  setLive(lat: number, lon: number): void {
    if (this.live && Math.abs(this.live.lat - lat) < 1e-7 && Math.abs(this.live.lon - lon) < 1e-7) return;
    this.live = { lat, lon };
    this.draw();
  }

  getPoints(): TrackPoint[] {
    return this.points;
  }

  clear(): void {
    this.points = [];
    this.live = null;
    this.draw();
  }

  refresh(): void {
    this.draw();
  }

  private removeAll(): void {
    const map = this.app.map as L.Map;
    for (const l of this.lines) map.removeLayer(l);
    for (const l of this.halos) map.removeLayer(l);
    for (const l of this.starts) map.removeLayer(l);
    this.lines = [];
    this.halos = [];
    this.starts = [];
  }

  private draw(): void {
    const map = this.app.map as L.Map;
    this.removeAll();

    // 把经度按连续性展开（跨越日期变更线时 179.9 → -179.8 变成 179.9 → 180.2），
    // 这样折线不会在地图上横跨一整圈；再整体平移到当前视野附近。
    const raw = this.points.map((p) => ({ lat: p.lat, lon: p.lon }));
    if (this.live) raw.push({ lat: this.live.lat, lon: this.live.lon });
    if (raw.length < 2) return;
    for (let i = 1; i < raw.length; i++) {
      let d = raw[i].lon - raw[i - 1].lon;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      raw[i].lon = raw[i - 1].lon + d;
    }
    const mid = raw[Math.floor(raw.length / 2)];
    const shift = Math.round((map.getCenter().lng - mid.lon) / 360) * 360;
    if (shift) for (const p of raw) p.lon += shift;

    // 每个可见世界副本各画一份，跨日期变更线拖动时航迹连续
    for (const off of copyOffsets(map)) {
      const latlngs = raw.map((p) => {
        const q = this.app.toLocal(p.lat, p.lon + off);
        return L.latLng(q.lat, q.lng);
      });
      const halo = L.polyline(latlngs, { color: '#0d1117', weight: 5, opacity: 0.55, lineCap: 'round' }).addTo(map);
      const line = L.polyline(latlngs, { color: '#ffd166', weight: 2, opacity: 0.95, lineCap: 'round' }).addTo(map);
      const start = L.circleMarker(latlngs[0], {
        radius: 3,
        color: '#ffd166',
        weight: 2,
        fillColor: '#0d1117',
        fillOpacity: 1,
      }).addTo(map);
      this.halos.push(halo);
      this.lines.push(line);
      this.starts.push(start);
    }
    for (const l of this.lines) l.bringToFront();
    for (const l of this.starts) l.bringToFront();
  }
}
