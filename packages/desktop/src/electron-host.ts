import { BrowserWindow } from 'electron';
import type { BrowserHost } from '../../server/src/sources/browser-host.js';

const BOOTSTRAP_URL = 'https://www.flightaware.com/live/map';
const TOKEN_TTL_MS = 20 * 60 * 1000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/**
 * 用 Electron 内置 Chromium（隐藏窗口）当抓取宿主：过 Cloudflare、取 VICINITY_TOKEN，
 * 并在该窗口的页面上下文里 fetch。无需额外打包第二份浏览器。
 */
export class ElectronBrowserHost implements BrowserHost {
  private win: BrowserWindow | null = null;
  private token: string | null = null;
  private tokenAt = 0;
  private busy: Promise<void> | null = null;

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = new BrowserWindow({
      show: false,
      width: 1366,
      height: 900,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        partition: 'persist:flightaware',
      },
    });
    win.webContents.setUserAgent(UA);
    this.win = win;
    return win;
  }

  private async setup(force = false): Promise<void> {
    if (this.token && !force && Date.now() - this.tokenAt < TOKEN_TTL_MS) return;
    if (!this.busy) {
      this.busy = this.doSetup(force).finally(() => {
        this.busy = null;
      });
    }
    await this.busy;
  }

  private async doSetup(force: boolean): Promise<void> {
    const win = this.ensureWindow();
    if (force) {
      try {
        await win.loadURL('about:blank');
      } catch {
        /* ignore */
      }
    }
    await win.loadURL(BOOTSTRAP_URL, { userAgent: UA });
    let token: unknown = null;
    for (let i = 0; i < 120; i++) {
      token = await win.webContents
        .executeJavaScript('window.mapGlobals && window.mapGlobals.VICINITY_TOKEN || null', true)
        .catch(() => null);
      if (token) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!token || typeof token !== 'string') {
      throw new Error('flightaware: Electron 未取到 VICINITY_TOKEN（Cloudflare 挑战未通过？）');
    }
    this.token = token;
    this.tokenAt = Date.now();
  }

  async ensureToken(force = false): Promise<string> {
    await this.setup(force);
    return this.token!;
  }

  async fetchText(url: string, accept: string): Promise<{ status: number; text: string }> {
    await this.setup();
    const win = this.ensureWindow();
    const code =
      `fetch(${JSON.stringify(url)}, { headers: { accept: ${JSON.stringify(accept)}, 'x-requested-with': 'XMLHttpRequest' }, credentials: 'include' })` +
      `.then(r => r.text().then(t => ({ status: r.status, text: t })))`;
    return win.webContents.executeJavaScript(code, true) as Promise<{ status: number; text: string }>;
  }

  async reset(): Promise<void> {
    this.token = null;
    this.tokenAt = 0;
    const w = this.win;
    this.win = null;
    if (w && !w.isDestroyed()) w.destroy();
  }

  async dispose(): Promise<void> {
    await this.reset();
  }
}
