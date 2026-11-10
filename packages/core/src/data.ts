import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAirportStore, type AirportStore } from './airports.js';
import { createFirStore, type FirStore } from './fir.js';
import { createNavaidStore, type NavaidStore } from './navaids.js';
import { createReportingPointStore, type ReportingPointStore } from './reporting-points.js';
import { defaultDataDir } from './paths.js';

/** `data/manifest.json` 中的单个数据集描述。 */
export interface DatasetInfo {
  file: string;
  /** 记录数（GeoJSON 为 feature 数）。 */
  count: number;
  /** 原始文件字节数。 */
  bytes: number;
  /** 原始文件 SHA-256（小写十六进制）。 */
  sha256: string;
  /** 上游来源名称。 */
  source: string;
  /** 上游来源 URL。 */
  sourceUrl?: string;
  /** 数据许可证（SPDX 或说明文字）。 */
  license: string;
  /** 抓取时间（ISO 8601）。 */
  retrievedAt?: string;
  /** 空域包专用：国家/地区数量。 */
  countries?: number;
}

export interface DataManifest {
  schemaVersion: number;
  /** 数据生成时间（ISO 8601）。 */
  generatedAt: string;
  datasets: Record<string, DatasetInfo>;
}

export interface CreateDataStoreOptions {
  /** 数据目录；默认 `FLIGHTRADAR_DATA_DIR` 或包内 `data/`。 */
  dataDir?: string;
}

export interface DataStore {
  readonly dir: string;
  readonly airports: AirportStore;
  readonly navaids: NavaidStore;
  readonly reportingPoints: ReportingPointStore;
  readonly fir: FirStore;
  readonly manifest: DataManifest | null;
}

export function loadManifest(dir: string): DataManifest | null {
  const file = join(dir, 'manifest.json');
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as DataManifest;
    return raw && typeof raw === 'object' && raw.datasets ? raw : null;
  } catch {
    return null;
  }
}

/**
 * 创建静态航空数据存储。每个数据集在第一次查询时懒加载；
 * 同一进程内可创建多个 store（测试、不同数据目录）。
 */
export function createDataStore(options: CreateDataStoreOptions = {}): DataStore {
  const dir = options.dataDir ?? defaultDataDir();
  return {
    dir,
    airports: createAirportStore(dir),
    navaids: createNavaidStore(dir),
    reportingPoints: createReportingPointStore(dir),
    fir: createFirStore(dir),
    manifest: loadManifest(dir),
  };
}
