// 数据准备：分别调用 core（机场/导航台/VRP/FIR）和 airspace（openAIP 空域）的 setup。
// 各包内部是幂等的：数据已存在就跳过。
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = [
  join(root, 'packages', 'core', 'scripts', 'setup-data.mjs'),
  join(root, 'packages', 'airspace', 'scripts', 'setup-data.mjs'),
];

for (const script of scripts) {
  console.log(`[setup] ${script}`);
  const res = spawnSync(process.execPath, [script], {
    stdio: 'inherit',
    cwd: dirname(script),
    env: { ...process.env, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? '1' },
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
}
