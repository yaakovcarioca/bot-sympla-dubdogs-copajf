import { chromium, type Browser, type BrowserContext } from 'playwright';
import { randomUserAgent } from '../utils/index.js';
import { logger } from '../logger/index.js';
import type { AppConfig } from '../types/index.js';

const RESOURCE_BLOCK_TYPES = new Set([
  'image',
  'media',
  'font',
  'stylesheet',
  'websocket',
]);

export class BrowserManager {
  private browser: Browser | null = null;
  private readonly config: AppConfig;
  private healthy: boolean = false;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    logger.info('Starting browser...', {
      headless: this.config.headless,
    });

    try {
      this.browser = await chromium.launch({
        headless: this.config.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-blink-features=AutomationControlled',
          '--disable-extensions',
        ],
      });

      this.healthy = true;
      logger.info('Browser started successfully');
    } catch (error) {
      this.healthy = false;
      logger.error('Failed to start browser', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async createContext(): Promise<BrowserContext> {
    if (!this.isRunning()) {
      logger.warn('Browser not healthy, restarting...');
      await this.restart();
    }

    const context = await this.browser!.newContext({
      userAgent: randomUserAgent(),
      viewport: { width: 1920, height: 1080 },
      locale: 'pt-BR',
      timezoneId: this.config.timezone,
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
    });

    await context.route('**/*', async (route) => {
      const resourceType = route.request().resourceType();
      if (RESOURCE_BLOCK_TYPES.has(resourceType)) {
        await route.abort();
      } else {
        await route.continue();
      }
    });

    return context;
  }

  async restart(): Promise<void> {
    logger.info('Restarting browser...');
    await this.stop();
    await this.start();
  }

  async stop(): Promise<void> {
    if (this.browser !== null) {
      try {
        await this.browser.close();
      } catch (error) {
        logger.warn('Error closing browser', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.browser = null;
      this.healthy = false;
    }
  }

  isRunning(): boolean {
    if (this.browser === null) return false;
    if (!this.healthy) return false;
    try {
      return this.browser.isConnected();
    } catch {
      this.healthy = false;
      return false;
    }
  }

  markUnhealthy(): void {
    this.healthy = false;
  }
}
