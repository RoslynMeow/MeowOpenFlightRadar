import { config } from './config.js';
import type { Notam, NotamResult } from '@flightradar/shared';

/**
 * NOTAM 数据源：SkyLink API（按机场 ICAO 查全球 NOTAM）。
 *
 * 用法：在 .env 配置 `SKYLINK_API_KEY`（在 https://skylinkapi.com/ 注册后于 dashboard 生成）。
 * 接口：GET https://data.skylinkapi.com/v3.1/notams/{ICAO}，头 `x-api-key`。
 * 限制：只支持机场 ICAO（3–4 字母）；FIR id / 空域名称查不到时返回空列表，
 * FIR 级全球查询需另接各国 AIS 源。
 */

const SKYLINK_BASE = 'https://data.skylinkapi.com/v3.1/notams/';
const SKYLINK_TIMEOUT_MS = 15000;

interface SkylinkNotam {
  raw?: string | null;
  notam_id?: string | null;
  notam_id_domestic?: string | null;
  type?: string | null;
  effective?: string | null;
  expiration?: string | null;
  body?: string | null;
}

interface SkylinkResponse {
  icao?: string;
  notams?: SkylinkNotam[];
}

const KIND_MAP: Record<string, string> = { N: 'NOTAMN', R: 'NOTAMR', C: 'NOTAMC' };

function toMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

type NotamSource = (target: string) => Promise<Notam[]>;

const source: NotamSource | null = config.skylinkApiKey
  ? async (target) => {
      const ident = target.trim().toUpperCase();
      if (!/^[A-Z]{3}([A-Z0-9])?$/.test(ident)) return [];
      const res = await fetch(SKYLINK_BASE + encodeURIComponent(ident), {
        headers: { 'x-api-key': config.skylinkApiKey },
        signal: AbortSignal.timeout(SKYLINK_TIMEOUT_MS),
      });
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`skylink HTTP ${res.status}`);
      const json = (await res.json()) as SkylinkResponse;
      return (json.notams ?? [])
        .map((n, i) => ({
          id: n.notam_id ?? n.notam_id_domestic ?? `${ident}#${i + 1}`,
          kind: n.type ? KIND_MAP[n.type] ?? n.type : null,
          from: toMs(n.effective),
          to: toMs(n.expiration),
          text: n.raw ?? n.body ?? '',
        }))
        .filter((n) => n.text);
    }
  : null;

export function hasNotamSource(): boolean {
  return source !== null;
}

export async function getNotams(target: string): Promise<NotamResult> {
  const t = target.trim();
  const time = Date.now();
  if (!t) return { target: t, available: false, message: '缺少查询目标', notams: [], time };

  const src: NotamSource | null = source;
  if (!src) {
    return {
      target: t,
      available: false,
      message: '尚未接入 NOTAM 数据源（在 .env 配置 SKYLINK_API_KEY）',
      notams: [],
      time,
    };
  }

  try {
    const notams = await src(t);
    return { target: t, available: true, notams, time };
  } catch (e) {
    return {
      target: t,
      available: true,
      message: e instanceof Error ? e.message : String(e),
      notams: [],
      time,
    };
  }
}
