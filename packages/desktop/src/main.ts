import { app, BrowserWindow } from 'electron';
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setBrowserHostFactory } from '../../server/src/sources/index.js';
import { dispose, startApiServer } from '../../server/src/app.js';
import { ElectronBrowserHost } from './electron-host.js';

const DIST_DIR = __dirname;
const WEB_DIR = app.isPackaged ? join(process.resourcesPath, 'web') : join(DIST_DIR, '..', '..', 'web', 'dist');
const DATA_DIR = app.isPackaged ? join(process.resourcesPath, 'data') : join(DIST_DIR, '..', '..', 'server', 'data');

let apiServer: ReturnType<typeof startApiServer> | null = null;
let webServer: Server | null = null;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

/** 把打包好的前端静态目录用本地 http 提供（file:// 下 ES module 会被 CORS 拦）。 */
function startStaticServer(dir: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
        let file = normalize(join(dir, urlPath));
        if (!file.startsWith(dir)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
        if (!existsSync(file)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('content-type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      } catch {
        res.statusCode = 500;
        res.end();
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      webServer = server;
      resolve(typeof a === 'object' && a ? a.port : 0);
    });
  });
}

async function startApi(): Promise<number> {
  const server = startApiServer(0);
  apiServer = server;
  return new Promise((resolve) => {
    server.once('listening', () => {
      const a = server.address();
      resolve(typeof a === 'object' && a ? a.port : 0);
    });
  });
}

async function main(): Promise<void> {
  process.env.FLIGHTRADAR_DATA_DIR = DATA_DIR;
  setBrowserHostFactory(() => new ElectronBrowserHost());

  const [apiPort, webPort] = await Promise.all([startApi(), startStaticServer(WEB_DIR)]);

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0f14',
    title: 'FlightRadar',
    webPreferences: {
      preload: join(DIST_DIR, 'preload.cjs'),
      additionalArguments: [`--fr-api-base=http://127.0.0.1:${apiPort}`],
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  await win.loadURL(`http://127.0.0.1:${webPort}/`);

  // 冒烟测试：FR_SMOKE=1 时等数据加载后打印关键状态再退出
  if (process.env.FR_SMOKE) {
    await new Promise((r) => setTimeout(r, 25000));
    const injected = await win.webContents
      .executeJavaScript('JSON.stringify(window.__FLIGHTRADAR__ || null)')
      .catch(() => 'null');
    const title = await win.webContents.executeJavaScript('document.title').catch(() => '');
    const status = await win.webContents
      .executeJavaScript("document.querySelector('#status')?.textContent || ''")
      .catch((e: unknown) => 'ERR:' + (e instanceof Error ? e.message : String(e)));
    console.log('[smoke] injected =', injected);
    console.log('[smoke] title =', title);
    console.log('[smoke] status =', status);
    app.quit();
  }
}

app.whenReady().then(main).catch((e) => {
  console.error('[desktop] 启动失败:', e);
  app.quit();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  void dispose();
  apiServer?.close();
  webServer?.close();
});
