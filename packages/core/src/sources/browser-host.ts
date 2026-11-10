import type { Browser, BrowserContext, Page } from 'playwright-core';
import { UpstreamError } from './types.js';

const BOOTSTRAP_URL = 'https://www.flightaware.com/live/map';
const TOKEN_TTL_MS = 20 * 60 * 1000;

/**
 * 抓取用的浏览器宿主抽象。负责过 Cloudflare、取 VICINITY_TOKEN、并在同一浏览器上下文里发请求。
 * 独立 server 用 Playwright 实现；Electron 用内置 Chromium（隐藏窗口）实现，避免额外打包浏览器。
 */
export interface BrowserHost {
  /** 取（必要时刷新）VICINITY_TOKEN。force=true 时强制重过盾。 */
  ensureToken(force?: boolean): Promise<string>;
  /** 在浏览器上下文里发起 GET，返回状态与文本。 */
  fetchText(url: string, accept: string): Promise<{ status: number; text: string }>;
  /** 失效重建（下次调用时重新过盾）。 */
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

let factory: (() => BrowserHost) | null = null;

/** 注入自定义宿主工厂（Electron 在启动时调用）。传 null 恢复默认（Playwright）。 */
export function setBrowserHostFactory(fn: (() => BrowserHost) | null): void {
  factory = fn;
}

export function getBrowserHostFactory(): () => BrowserHost {
  return factory ?? (() => new PlaywrightBrowserHost());
}

/** 默认实现：playwright-core 无头 Chromium。 */
export class PlaywrightBrowserHost implements BrowserHost {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private token: string | null = null;
  private tokenAt = 0;
  private busy: Promise<void> | null = null;

  private async ensureReady(force = false): Promise<void> {
    if (this.context && this.page && this.token && !force && Date.now() - this.tokenAt < TOKEN_TTL_MS) return;
    if (!this.busy) {
      this.busy = this.setup().finally(() => {
        this.busy = null;
      });
    }
    await this.busy;
  }

  private async setup(): Promise<void> {
    if (!this.browser) {
      let chromium: typeof import('playwright-core')['chromium'];
      try {
        ({ chromium } = await import('playwright-core'));
      } catch {
        throw new UpstreamError(501, 'flightaware: 需要 playwright-core（npm i playwright-core）');
      }
      try {
        this.browser = await chromium.launch({
          headless: true,
          args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new UpstreamError(501, `flightaware: 无法启动 Chromium（先运行 npx playwright-core install chromium）: ${msg}`);
      }
      const major = String(this.browser.version()).split('.')[0];
      const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
      this.context = await this.browser.newContext({
        userAgent: ua,
        viewport: { width: 1366, height: 900 },
        locale: 'en-US',
        timezoneId: 'UTC',
      });
      await this.context.addInitScript("try{Object.defineProperty(navigator,'webdriver',{get:()=>undefined})}catch(e){}");
      this.page = await this.context.newPage();
    }

    const nav = await this.page!.goto(BOOTSTRAP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page!
      .waitForFunction('window.mapGlobals && window.mapGlobals.VICINITY_TOKEN', null, { timeout: 60000 })
      .catch(() => {});
    const token = (await this.page!.evaluate('window.mapGlobals && window.mapGlobals.VICINITY_TOKEN || null')) as
      | string
      | null;
    if (!token) {
      const status = nav ? nav.status() : 0;
      throw new UpstreamError(status === 403 ? 403 : 502, 'flightaware: 浏览器未取到 VICINITY_TOKEN（Cloudflare 挑战未通过？）');
    }
    this.token = token;
    this.tokenAt = Date.now();
  }

  private async reqGet(url: string, accept: string): Promise<{ status: number; text: string }> {
    return this.page!.evaluate(
      async (args: { url: string; accept: string }) => {
        const r = await fetch(args.url, {
          headers: { accept: args.accept, 'x-requested-with': 'XMLHttpRequest' },
          credentials: 'include',
        });
        return { status: r.status, text: await r.text() };
      },
      { url, accept },
    );
  }

  async ensureToken(force = false): Promise<string> {
    await this.ensureReady(force);
    return this.token!;
  }

  async fetchText(url: string, accept: string): Promise<{ status: number; text: string }> {
    await this.ensureReady();
    return this.reqGet(url, accept);
  }

  async reset(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.token = null;
    this.tokenAt = 0;
    if (b) {
      try {
        await b.close();
      } catch {
        /* ignore */
      }
    }
  }

  async dispose(): Promise<void> {
    await this.reset();
  }
}
