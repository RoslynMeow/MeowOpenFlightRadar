import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 数据目录：优先 `FLIGHTRADAR_DATA_DIR`（Electron 打包时指向随包资源），
 * 否则回退到源码旁的 `../data`。
 */
export function dataDir(): string {
  const env = process.env.FLIGHTRADAR_DATA_DIR;
  if (env) return env;
  try {
    return join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  } catch {
    return join(process.cwd(), 'data');
  }
}
