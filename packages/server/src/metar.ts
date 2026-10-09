import type { WeatherCloud } from '@flightradar/shared';

/** 从 METAR 原文解码出的要素（与 aviationweather.gov 解码结果对齐）。 */
export interface DecodedMetar {
  at: number | null;
  tempC: number | null;
  dewpointC: number | null;
  windDirDeg: number | null;
  windVar: boolean;
  windSpeedKt: number | null;
  windGustKt: number | null;
  /** 能见度（字符串，单位 SM，如 "3.73"；10+ 表示极好）。 */
  visibility: string | null;
  altimHpa: number | null;
  flightCategory: string | null;
  weather: string | null;
  clouds: WeatherCloud[];
}

const EMPTY: DecodedMetar = {
  at: null,
  tempC: null,
  dewpointC: null,
  windDirDeg: null,
  windVar: false,
  windSpeedKt: null,
  windGustKt: null,
  visibility: null,
  altimHpa: null,
  flightCategory: null,
  weather: null,
  clouds: [],
};

function signedTemp(t: string): number {
  return t.startsWith('M') ? -Number(t.slice(1)) : Number(t);
}

/** DDHHMMZ → Unix 毫秒（按当前 UTC 年月推断；跨月时回退一个月）。 */
function obsMillis(ddhhmmz: string, now: number): number | null {
  const day = Number(ddhhmmz.slice(0, 2));
  const hh = Number(ddhhmmz.slice(2, 4));
  const mi = Number(ddhhmmz.slice(4, 6));
  if ([day, hh, mi].some((n) => !Number.isFinite(n))) return null;
  const d = new Date(now);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day, hh, mi);
  if (t > now + 48 * 3600_000) t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, day, hh, mi);
  return t;
}

function mpsToKt(v: number): number {
  return Math.round(v * 1.94384);
}

function kmhToKt(v: number): number {
  return Math.round(v * 0.539957);
}

function visSmText(meters: number): string {
  const sm = meters / 1609.344;
  if (sm >= 10) return '10+';
  return String(Math.round(sm * 100) / 100);
}

/** 按美国标准由云底/能见度推算飞行类别。 */
function flightCategory(visSm: number | null, clouds: WeatherCloud[]): string | null {
  if (visSm === null && !clouds.length) return null;
  let ceil: number | null = null;
  for (const c of clouds) {
    if ((c.cover === 'BKN' || c.cover === 'OVC' || c.cover === 'VV') && c.baseFt != null) {
      ceil = ceil === null ? c.baseFt : Math.min(ceil, c.baseFt);
    }
  }
  const v = visSm ?? 10;
  if (v < 1 || (ceil !== null && ceil < 500)) return 'LIFR';
  if (v < 3 || (ceil !== null && ceil < 1000)) return 'IFR';
  if (v <= 5 || (ceil !== null && ceil <= 3000)) return 'MVFR';
  return 'VFR';
}

const WX_PHENO =
  /^([+-]?)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY)$|^(TS|SQ|FC)$/;

/** 解析一条 METAR 原文（支持 KT / MPS / KMH、米制或 SM 能见度、Q / A 气压）。 */
export function decodeMetar(raw: string, now = Date.now()): DecodedMetar {
  const out: DecodedMetar = { ...EMPTY, clouds: [] };
  const toks = raw.trim().split(/\s+/);

  const obs = toks.find((t) => /^\d{6}Z$/.test(t));
  if (obs) out.at = obsMillis(obs, now);

  const cavok = toks.includes('CAVOK');
  for (const t of toks) {
    // 风
    const w = t.match(/^(VRB|\d{3}|M\d{2})(\d{2,3})(G(\d{2,3}))?(KT|MPS|KMH)$/);
    if (w) {
      out.windVar = w[1] === 'VRB';
      out.windDirDeg = w[1] === 'VRB' ? null : Number(w[1].replace('M', ''));
      const spd = Number(w[2]);
      const unit = w[5];
      out.windSpeedKt = unit === 'KT' ? spd : unit === 'MPS' ? mpsToKt(spd) : kmhToKt(spd);
      if (w[4]) {
        const g = Number(w[4]);
        out.windGustKt = unit === 'KT' ? g : unit === 'MPS' ? mpsToKt(g) : kmhToKt(g);
      }
      continue;
    }
    // 温度 / 露点
    const td = t.match(/^(M?\d{1,2})\/(M?\d{1,2})$/);
    if (td) {
      out.tempC = signedTemp(td[1]);
      out.dewpointC = signedTemp(td[2]);
      continue;
    }
    // 气压
    const q = t.match(/^Q(\d{3,4})$/);
    if (q) {
      out.altimHpa = Number(q[1]);
      continue;
    }
    const a = t.match(/^A(\d{3,4})$/);
    if (a) {
      const s = a[1];
      const inches = Number(`${s.slice(0, s.length - 2)}.${s.slice(-2)}`);
      out.altimHpa = Math.round(inches * 33.8639);
      continue;
    }
    // 云（含垂直能见度 VV）
    const c = t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/);
    if (c) {
      out.clouds.push({ cover: c[1] === 'VV' ? 'OVC' : c[1], baseFt: Number(c[2]) * 100 });
      continue;
    }
    if (t === 'NSC' || t === 'SKC' || t === 'CLR') {
      out.clouds.push({ cover: t, baseFt: null });
      continue;
    }
    // 能见度（公制：独立 4 位数字；英制：10SM / 1 1/2SM 之类单独处理）
    if (/^\d{4}$/.test(t) && out.visibility === null && !cavok) {
      const m = Number(t);
      if (m !== 9999) out.visibility = visSmText(m);
      else out.visibility = '10+';
      continue;
    }
    const sm = t.match(/^(\d+)SM$/);
    if (sm && out.visibility === null) {
      out.visibility = Number(sm[1]) >= 10 ? '10+' : sm[1];
      continue;
    }
    // 现时天气现象
    if (!out.weather && WX_PHENO.test(t) && t.length <= 8) out.weather = t;
  }
  if (cavok) {
    out.visibility = '10+';
    out.clouds = [{ cover: 'CAVOK', baseFt: null }];
  }

  const visNum = out.visibility ? parseFloat(out.visibility) : NaN;
  out.flightCategory = flightCategory(Number.isFinite(visNum) ? visNum : null, out.clouds);
  return out;
}

/** TAF 首段 `DDHHMMZ` 发布时刻。 */
export function tafIssuedMillis(raw: string, now = Date.now()): number | null {
  const m = raw.match(/\b(\d{6})Z\b/);
  return m ? obsMillis(m[1], now) : null;
}
