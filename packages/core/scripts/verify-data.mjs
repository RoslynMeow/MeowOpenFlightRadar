// 发布前校验：数据文件存在、条数达标、manifest 哈希一致。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'data');
const manifestFile = join(dir, 'manifest.json');

const MIN_COUNTS = {
  airports: 9000,
  navaids: 8000,
  reportingPoints: 3000,
  fir: 500,
};

function fail(msg) {
  console.error(`[verify] ✗ ${msg}`);
  process.exitCode = 1;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

if (!existsSync(manifestFile)) {
  fail(`缺少 ${manifestFile}，请先运行: npm run setup:data`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
for (const [key, info] of Object.entries(manifest.datasets ?? {})) {
  const file = join(dir, info.file);
  if (!existsSync(file)) {
    fail(`${key}: 缺少 ${file}`);
    continue;
  }
  const buf = readFileSync(file);
  if (buf.length !== info.bytes) fail(`${key}: 字节数变化（manifest ${info.bytes}，实际 ${buf.length}）`);
  if (sha256(buf) !== info.sha256) fail(`${key}: SHA-256 不一致，请重新生成 manifest`);
  if (info.count < (MIN_COUNTS[key] ?? 0)) fail(`${key}: 条数 ${info.count} 低于下限 ${MIN_COUNTS[key]}`);
  if (!info.license) fail(`${key}: 缺少 license`);
  console.log(`[verify] ✓ ${key}: ${info.count} 条, ${(info.bytes / 1048576).toFixed(2)} MB`);
}

// 基础结构检查
const airports = JSON.parse(readFileSync(join(dir, 'airports.json'), 'utf8'));
if (!airports.every((a) => a.ident && Number.isFinite(a.lat) && Number.isFinite(a.lon) && Array.isArray(a.runways))) {
  fail('airports.json: 存在缺字段或坐标非法的记录');
}
const runways = airports.reduce((n, a) => n + a.runways.length, 0);
if (runways < 10000) fail(`airports.json: 跑道数 ${runways} 低于下限 10000`);
console.log(`[verify] ✓ 机场结构, ${runways} 条跑道`);

const navaids = JSON.parse(readFileSync(join(dir, 'navaids.json'), 'utf8'));
if (!navaids.every((n) => n.ident && Number.isFinite(n.lat) && Number.isFinite(n.lon))) {
  fail('navaids.json: 存在缺字段或坐标非法的记录');
}

const fir = JSON.parse(readFileSync(join(dir, 'fir.geojson'), 'utf8'));
if (!Array.isArray(fir.features)) fail('fir.geojson: 不是 FeatureCollection');

if (process.exitCode) {
  console.error('[verify] 数据校验失败');
} else {
  console.log('[verify] 数据校验通过');
}
