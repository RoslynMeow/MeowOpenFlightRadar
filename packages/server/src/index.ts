import { dispose, startApiServer } from './app.js';

/** 独立 API 进程入口（`npm start`）。开发时用 `src/dev.ts`（API + Vite 同进程）。 */
const server = startApiServer();

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  try {
    await dispose();
  } catch {
    /* ignore */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 800).unref();
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
