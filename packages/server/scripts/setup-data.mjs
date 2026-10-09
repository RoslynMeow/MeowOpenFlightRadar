// 数据准备：检查生成的数据文件，缺失的才运行对应导入脚本（幂等，已存在则跳过）。
// 由根 package.json 的 predev / prebuild / prestart 自动调用。
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, '..');
const dataDir = join(serverDir, 'data');

const jobs = [
  { name: '机场 / 导航台 (OurAirports)', script: 'import-airports.mjs', check: ['airports.json', 'navaids.json'] },
  { name: '空域 (openAIP)', script: 'import-airspace.mjs', check: [join('airspace', 'index.json')] },
  { name: '情报区 (VATSpy)', script: 'import-fir.mjs', check: ['fir.geojson'] },
];

let imported = 0;
for (const job of jobs) {
  const missing = job.check.some((f) => !existsSync(join(dataDir, f)));
  if (!missing) {
    console.log(`[setup] ${job.name}: 已存在，跳过`);
    continue;
  }
  console.log(`[setup] ${job.name}: 缺失，开始导入…`);
  const res = spawnSync(process.execPath, [join(here, job.script)], {
    stdio: 'inherit',
    cwd: serverDir,
    env: { ...process.env, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? '1' },
  });
  if (res.status !== 0) {
    console.error(`[setup] ${job.name} 导入失败（退出码 ${res.status}）`);
    process.exit(res.status ?? 1);
  }
  imported++;
}

console.log(imported > 0 ? `[setup] 完成：导入 ${imported} 项` : '[setup] 数据齐全，无需导入');
