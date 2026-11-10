// openAIP 全球空域数据准备：index.json 缺失时运行 import-airspace.mjs，然后生成 manifest。
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..');
const index = join(pkgDir, 'data', 'airspace', 'index.json');

if (existsSync(index)) {
  console.log('[setup] 空域: 已存在，跳过导入');
} else {
  console.log('[setup] 空域: 缺失，开始导入…');
  const res = spawnSync(process.execPath, [join(here, 'import-airspace.mjs')], {
    stdio: 'inherit',
    cwd: pkgDir,
    env: { ...process.env, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? '1' },
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

const manifest = spawnSync(process.execPath, [join(here, 'build-manifest.mjs')], {
  stdio: 'inherit',
  cwd: pkgDir,
});
process.exit(manifest.status ?? 0);
