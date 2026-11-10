// SkyVector 航图瓦片代理（World VFR 301 / World Lo 302 / World Hi 304）。
// 瓦片路径: {tileBase}/{protoid}/{edition}/{scale}/{x}/{y}.jpg。
// 注意 SkyVector 的网格不是 2 的幂 Web 瓦片：世界像素宽按图固定（524288/393216/196608），
// scale s 对应每边瓦片数 N = width/256/scalors[s]；scalors 表按上游逻辑分两套（见下 CHART_CFG 注释）。
// 本服务只按原始 (scale,x,y) 转发，标准 XYZ 裁剪拼接在 web 端 chart-layer 完成。
// 注意: World 系列为 Jeppesen 授权数据，仅供个人测试，不要公开分发。
import { TTLCache } from './cache.js';

export const SKYVECTOR_CHARTS: Record<string, number> = { vfr: 301, lo: 302, hi: 304 };
export const SKYVECTOR_PROTOIDS = new Set(Object.values(SKYVECTOR_CHARTS));

/** 每张图的世界像素宽与 maxzoom（/api/init）。上游 setProj：maxzoom 奇 → scalors2（每级 ×2^(1/3)），偶 → scalors1（每级 ×1.5）。 */
const CHART_CFG: Record<number, { w: number; mz: number }> = { 301: { w: 524288, mz: 21 }, 302: { w: 393216, mz: 20 }, 304: { w: 196608, mz: 18 } };
const SCALORS2 = [2 / 3, 1, 4 / 3, 2, 8 / 3, 4, 16 / 3, 8, 32 / 3, 16, 64 / 3, 32, 128 / 3, 64, 256 / 3, 128, 512 / 3, 256, 1024 / 3, 512, 2048 / 3, 1024, 4096 / 3, 2048];
const SCALORS1 = [0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048];

/** 该 scale 下每边瓦片数（用于入参校验）。 */
export function skyvectorGridSize(protoid: number, scale: number): number {
  const c = CHART_CFG[protoid];
  if (!c || scale < 0) return 0;
  const sc = (c.mz % 2 ? SCALORS2 : SCALORS1)[scale];
  if (!sc) return 0;
  return Math.round(c.w / 256 / sc);
}

const INIT_URL = 'https://skyvector.com/api/init?lat=39&lon=-98';
const SESSION_TTL_MS = 8 * 60 * 1000;
const TILE_TTL_MS = 12 * 60 * 60 * 1000;

interface Session {
  tileBase: string;
  edition: number;
  fetchedAt: number;
}

let session: Session | null = null;
let pendingInit: Promise<Session> | null = null;
const tileCache = new TTLCache<string, Uint8Array>(TILE_TTL_MS, 2000);

async function initSession(): Promise<Session> {
  const res = await fetch(INIT_URL, {
    headers: { 'user-agent': 'Mozilla/5.0 (FlightRadar personal test)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`skyvector init HTTP ${res.status}`);
  const body = (await res.json()) as { tileservers?: string; edition?: number };
  const tileBase = (body.tileservers ?? '').split(',')[0].replace(/\/+$/, '');
  const edition = Number(body.edition);
  if (!tileBase.startsWith('https://') || !Number.isFinite(edition) || edition <= 0) {
    throw new Error('skyvector init malformed');
  }
  return { tileBase, edition, fetchedAt: Date.now() };
}

/** 取当前会话（缓存 + 并发去重）。force 时强制刷新（404 后重试）。 */
async function getSession(force = false): Promise<Session> {
  if (!force && session && Date.now() - session.fetchedAt < SESSION_TTL_MS) return session;
  if (!force && pendingInit) return pendingInit;
  const task = initSession()
    .then((s) => {
      session = s;
      return s;
    })
    .finally(() => {
      if (pendingInit === task) pendingInit = null;
    });
  pendingInit = task;
  return task;
}

async function requestTile(s: Session, protoid: number, scale: number, x: number, y: number): Promise<Uint8Array | null> {
  const res = await fetch(`${s.tileBase}/${protoid}/${s.edition}/${scale}/${x}/${y}.jpg`, {
    headers: { 'user-agent': 'Mozilla/5.0 (FlightRadar personal test)' },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`skyvector tile HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) return null;
  return new Uint8Array(await res.arrayBuffer());
}

/** 取一张原生 (scale,x,y) 航图瓦片，404/空返回 null。token 过期时自动刷新重试一次。 */
export async function skyvectorTile(protoid: number, scale: number, x: number, y: number): Promise<Uint8Array | null> {
  const s0 = await getSession();
  const key = `${s0.edition}/${protoid}/${scale}/${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit) return hit.byteLength ? hit : null;
  let buf = await requestTile(s0, protoid, scale, x, y);
  if (buf === null) {
    const s1 = await getSession(true);
    if (s1.tileBase !== s0.tileBase || s1.edition !== s0.edition) {
      buf = await requestTile(s1, protoid, scale, x, y);
    }
  }
  if (buf) tileCache.set(key, buf);
  else tileCache.set(key, new Uint8Array(0)); // 空瓦片（海域/越界）负缓存，避免反复回源
  return buf;
}

/** 当前周期信息（前端展示 edition 用）。 */
export async function skyvectorMeta(): Promise<{ edition: number; charts: Record<string, number> }> {
  const s = await getSession();
  return { edition: s.edition, charts: SKYVECTOR_CHARTS };
}
