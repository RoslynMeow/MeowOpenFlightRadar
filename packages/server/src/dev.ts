import { createServer as createViteServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { dispose, startApiServer } from './app.js';

/**
 * 开发入口：API（Hono）与前端（Vite）跑在**同一个 Node 进程**里。
 * `npm run dev` 只启这一个进程，Ctrl+C 一次全部退出，不再有独立后端/僵尸进程。
 * Vite 通过 vite.config.ts 的 proxy 把 /api、/event、/health 转到本进程内的 8787。
 */
const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../../web');

const api = startApiServer();

const vite = await createViteServer({
  root: webRoot,
  configFile: resolve(webRoot, 'vite.config.ts'),
});
await vite.listen();
vite.printUrls();

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log('\n[dev] 正在退出（API + Vite 同进程）…');
  try {
    await vite.close();
  } catch {
    /* ignore */
  }
  api.close();
  try {
    await dispose();
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('SIGHUP', () => void shutdown());
