import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 数据目录：优先 `FLIGHTRADAR_DATA_DIR`（Electron 打包时指向随包资源），
 * 否则回退到包内的 `data/`。
 *
 * 编译后 `dist/paths.js` 的上一级就是包根目录，所以 `../data` 同时适用于
 * 源码（tsx）与发布产物。
 */
export function defaultDataDir(): string {
  const env = process.env.FLIGHTRADAR_DATA_DIR;
  if (env) return env;
  try {
    return join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  } catch {
    return join(process.cwd(), 'data');
  }
}

/** @deprecated 使用 `defaultDataDir()` 或显式传入 `dataDir`。 */
export function dataDir(): string {
  return defaultDataDir();
}
