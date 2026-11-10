// 发布前校验：空域文件存在、要素数达标、manifest 哈希一致。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataRoot = join(here, '..', 'data');
const dir = join(dataRoot, 'airspace');
const manifestFile = join(dataRoot, 'manifest.json');

function fail(msg) {
  console.error(`[verify] ✗ ${msg}`);
  process.exitCode = 1;
}

if (!existsSync(manifestFile)) {
  fail(`缺少 ${manifestFile}，请先运行: npm run setup:data`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const info = manifest.datasets?.airspace;
if (!info) {
  fail('manifest 缺少 airspace 数据集');
  process.exit(1);
}

const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.geojson'))
  .sort();
const hash = createHash('sha256');
let count = 0;
let bytes = 0;
for (const file of files) {
  const buf = readFileSync(join(dir, file));
  const gj = JSON.parse(buf.toString('utf8'));
  count += gj.features?.length ?? 0;
  bytes += buf.length;
  hash.update(file).update('\0').update(buf);
}

if (hash.digest('hex') !== info.sha256) fail('SHA-256 不一致，请重新生成 manifest');
if (bytes !== info.bytes) fail(`字节数变化（manifest ${info.bytes}，实际 ${bytes}）`);
if (count !== info.count) fail(`要素数变化（manifest ${info.count}，实际 ${count}）`);
if (count < 5000) fail(`要素数 ${count} 低于下限 5000`);
if (Object.keys(index).length < 100) fail(`国家数 ${Object.keys(index).length} 低于下限 100`);
if (!info.license) fail('缺少 license');

console.log(`[verify] ✓ airspace: ${Object.keys(index).length} 个国家, ${count} 个要素, ${(bytes / 1048576).toFixed(2)} MB`);
console.log(process.exitCode ? '[verify] 数据校验失败' : '[verify] 数据校验通过');
