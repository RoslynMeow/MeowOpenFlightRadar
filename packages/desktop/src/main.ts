import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setBrowserHostFactory } from '../../server/src/sources/index.js';
import { dispose, startApiServer } from '../../server/src/app.js';
import { ElectronBrowserHost } from './electron-host.js';

const REPO = 'RoslynMeow/MeowOpenFlightRadar';

const DIST_DIR = __dirname;
const WEB_DIR = app.isPackaged ? join(process.resourcesPath, 'web') : join(DIST_DIR, '..', '..', 'web', 'dist');
const DATA_DIR = app.isPackaged ? join(process.resourcesPath, 'data') : join(DIST_DIR, '..', '..', 'server', 'data');

let apiServer: ReturnType<typeof startApiServer> | null = null;
let webServer: Server | null = null;

// ── 偏好（自动更新开关）持久化在 userData/prefs.json ──
interface Prefs {
  autoUpdate: boolean;
}
const prefs: Prefs = loadPrefs();

function prefsPath(): string {
  return join(app.getPath('userData'), 'prefs.json');
}
function loadPrefs(): Prefs {
  try {
    return { autoUpdate: true, ...(JSON.parse(readFileSync(prefsPath(), 'utf8')) as Partial<Prefs>) };
  } catch {
    return { autoUpdate: true };
  }
}
function savePrefs(): void {
  try {
    writeFileSync(prefsPath(), JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

function isNewer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

/** 便携版无法就地更新：检查 GitHub 最新 Release，有新版则引导去下载页。 */
async function checkForUpdates(manual: boolean): Promise<void> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'FlightRadar-Desktop' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rel = (await res.json()) as { tag_name?: string; html_url?: string };
    const latest = (rel.tag_name ?? '').replace(/^v/, '');
    const current = app.getVersion();
    if (latest && isNewer(latest, current)) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: '发现新版本',
        message: `发现新版本 v${latest}（当前 v${current}）`,
        detail: '便携版需手动下载替换，是否前往下载页面？',
        buttons: ['前往下载', '稍后'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0 && rel.html_url) void shell.openExternal(rel.html_url);
    } else if (manual) {
      await dialog.showMessageBox({ type: 'info', title: '检查更新', message: `已是最新版本（v${current}）`, buttons: ['好'] });
    }
  } catch (e) {
    if (manual) {
      await dialog.showMessageBox({
        type: 'error',
        title: '检查更新失败',
        message: e instanceof Error ? e.message : String(e),
        buttons: ['好'],
      });
    }
  }
}

ipcMain.on('fr:autoupdate', (_e, v: unknown) => {
  prefs.autoUpdate = v === true;
  savePrefs();
});
ipcMain.on('fr:check-updates', () => {
  void checkForUpdates(true);
});

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

  // 启动时自动检查更新（仅打包版；冒烟测试不弹窗）
  if (app.isPackaged && prefs.autoUpdate && !process.env.FR_SMOKE) {
    setTimeout(() => void checkForUpdates(false), 5000);
  }

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
