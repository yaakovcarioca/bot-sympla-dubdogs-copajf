import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { WatcherResult, TicketInfo, TicketStatus } from '../types/index.js';
import type { Watcher } from './index.js';
import type { BrowserManager } from './browser.manager.js';
import { logger } from '../logger/index.js';
import { retry } from '../utils/index.js';

const WAIT_SELECTORS = [
  '[class*="ticket"]',
  '[class*="ingresso"]',
  '[class*="lote"]',
  '[class*="event"]',
  'button',
  'main',
  'section',
];

const TICKET_CONTAINER_SELECTORS = [
  '[class*="ticket"]',
  '[class*="lote"]',
  '[class*="card-ticket"]',
  '[class*="event-ticket"]',
  '[data-testid*="ticket"]',
  'li[class*="ticket"]',
  '[class*="ingresso"]',
  '[class*="ticket-card"]',
  '[class*="card-ingresso"]',
];

const NAME_SELECTORS = [
  '[class*="name"]',
  '[class*="title"]',
  '[class*="nome"]',
  '[class*="categoria"]',
  'h2',
  'h3',
  'h4',
  'strong',
  '[class*="ingresso-name"]',
  '[class*="ticket-name"]',
];

const PRICE_SELECTORS = [
  '[class*="price"]',
  '[class*="preco"]',
  '[class*="valor"]',
  '[class*="currency"]',
  '[class*="ticket-price"]',
];

export class SymplaWatcher implements Watcher {
  private readonly eventUrl: string;
  private readonly browserManager: BrowserManager;

  constructor(eventUrl: string, browserManager: BrowserManager) {
    this.eventUrl = eventUrl;
    this.browserManager = browserManager;
  }

  async check(): Promise<WatcherResult> {
    const start = performance.now();
    const strategiesUsed: string[] = [];

    try {
      const result = await retry(
        () => this.executeCheck(strategiesUsed),
        {
          maxAttempts: 3,
          baseDelayMs: 2000,
          onRetry: (attempt, error) => {
            logger.warn('Retrying check', {
              attempt,
              error: error.message,
              url: this.eventUrl,
            });
          },
        },
      );

      return { ...result, executionTimeMs: performance.now() - start };
    } catch (error) {
      return {
        status: 'error',
        eventName: 'Sympla Event',
        eventUrl: this.eventUrl,
        availableTickets: [],
        checkedAt: new Date().toISOString(),
        executionTimeMs: performance.now() - start,
        error: error instanceof Error ? error.message : String(error),
        strategiesUsed,
      };
    }
  }

  private async executeCheck(strategiesUsed: string[]): Promise<WatcherResult> {
    let context;
    try {
      context = await this.browserManager.createContext();
    } catch {
      await this.browserManager.restart();
      context = await this.browserManager.createContext();
    }

    const page = await context.newPage();

    try {
      page.setDefaultTimeout(30_000);
      page.setDefaultNavigationTimeout(30_000);

      await page.goto(this.eventUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
        logger.debug('Network idle timeout reached, continuing with loaded page');
      });

      await page.waitForTimeout(3000);

      for (const selector of WAIT_SELECTORS) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
        } catch {
          continue;
        }
      }

      const html = await page.content();
      const $ = cheerio.load(html);

      return this.analyzePage($, strategiesUsed);
    } finally {
      await context.close();
    }
  }

  private extractEventName($: cheerio.CheerioAPI): string {
    const selectors = [
      'h1',
      'meta[property="og:title"]',
      '[class*="event-name"]',
      '[class*="evento-title"]',
      '[class*="title"]',
      'title',
    ];

    for (const selector of selectors) {
      try {
        const el = $(selector).first();
        if (el.length === 0) continue;

        const text =
          selector === 'meta[property="og:title"]'
            ? el.attr('content')
            : selector === 'title'
              ? el.text().trim()
              : el.text().trim();

        if (typeof text === 'string' && text.length > 0) {
          return text;
        }
      } catch {
        continue;
      }
    }

    return 'Evento Sympla';
  }

  private analyzePage(
    $: cheerio.CheerioAPI,
    strategiesUsed: string[],
  ): WatcherResult {
    const tickets: TicketInfo[] = [];
    const bodyText = $('body').text().toLowerCase();

    const hasEsgotado = /esgotado|ingressos? esgotados?|esgotadas/i.test(bodyText);
    const hasComprar = /comprar|garantir ingresso|garanta|compre agora|quero ingresso/i.test(bodyText);
    const hasDisponivel = /ingresso dispon[ií]vel|dispon[ií]vel|comprar ingresso|ingressos dispon[ií]veis/i.test(bodyText);

    strategiesUsed.push('text-keywords');
    logger.debug('Text analysis', { hasEsgotado, hasComprar, hasDisponivel });

    strategiesUsed.push('button-analysis');
    const { hasBuyButton, hasSoldOutButton } = this.analyzeButtons($);

    strategiesUsed.push('ticket-containers');
    this.extractTicketsFromContainers($, tickets);

    strategiesUsed.push('price-context');
    this.extractTicketsFromPriceContext($, tickets);

    if (tickets.length === 0) {
      strategiesUsed.push('fallback-text-parsing');
      this.fallbackTextParsing(bodyText, tickets);
    }

    const { status, availableTickets } = this.determineStatus(
      tickets,
      hasEsgotado,
      hasComprar,
      hasDisponivel,
      hasBuyButton,
      hasSoldOutButton,
    );

    return {
      status,
      eventName: this.extractEventName($),
      eventUrl: this.eventUrl,
      availableTickets,
      checkedAt: new Date().toISOString(),
      executionTimeMs: 0,
      strategiesUsed,
    };
  }

  private analyzeButtons($: cheerio.CheerioAPI): {
    hasBuyButton: boolean;
    hasSoldOutButton: boolean;
  } {
    const buttons = $(
      'button, a[class*="btn"], [class*="button"], [class*="botao"], [role="button"]',
    );

    let hasBuyButton = false;
    let hasSoldOutButton = false;

    buttons.each((_, el) => {
      const text = $(el).text().toLowerCase().trim();
      if (/comprar|garantir|garanta|quero|adquirir/i.test(text)) {
        hasBuyButton = true;
      }
      if (/esgotado|indispon[ií]vel/i.test(text)) {
        hasSoldOutButton = true;
      }
    });

    return { hasBuyButton, hasSoldOutButton };
  }

  private extractTicketsFromContainers(
    $: cheerio.CheerioAPI,
    tickets: TicketInfo[],
  ): void {
    for (const selector of TICKET_CONTAINER_SELECTORS) {
      const elements = $(selector);
      if (elements.length === 0) continue;

      let found = false;
      elements.each((_, el) => {
        const $el = $(el);
        const ticketText = $el.text().trim();
        if (ticketText.length === 0) return;

        const name = this.extractTicketName($el);
        if (name === undefined) return;
        if (tickets.some((t) => t.name === name)) return;

        const ticketStatus = this.extractTicketStatus($el);
        const price = this.extractPrice($el);
        const qty = this.extractQuantity($el);

        tickets.push({
          name,
          status: ticketStatus,
          price,
          quantityRemaining: qty,
        });
        found = true;
      });

      if (found) break;
    }
  }

  private extractTicketsFromPriceContext(
    $: cheerio.CheerioAPI,
    tickets: TicketInfo[],
  ): void {
    const priceElements = $(
      '[class*="price"], [class*="preco"], [class*="valor"]',
    );

    priceElements.each((_, el) => {
      const text = $(el).text().toLowerCase();
      if (!/esgotado/i.test(text)) return;

      const parent = $(el).closest(
        '[class*="ticket"], [class*="lote"], [class*="card"], li, [class*="item"]',
      );
      if (parent.length === 0) return;

      const name = this.extractTicketName(parent);
      if (name === undefined) return;
      if (tickets.some((t) => t.name === name)) return;

      tickets.push({ name, status: 'sold_out' });
    });
  }

  private fallbackTextParsing(
    bodyText: string,
    tickets: TicketInfo[],
  ): void {
    const lines = bodyText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      if (
        /(ingresso|lote|categoria|entrada)/i.test(line) &&
        line.length < 200
      ) {
        const isSoldOut = /esgotado/i.test(line);
        const isAvailable = /dispon[ií]vel|comprar/i.test(line);
        const priceMatch = line.match(/R?\$[\s]*\d+[,\.]\d+/);

        if (isSoldOut || isAvailable) {
          const existingName = line.replace(/esgotado|dispon[ií]vel|comprar/gi, '').trim();
          if (
            existingName.length > 3 &&
            !tickets.some((t) => t.name === existingName)
          ) {
            tickets.push({
              name: existingName,
              status: isSoldOut ? 'sold_out' : 'available',
              price: priceMatch?.[0],
            });
          }
        }
      }
    }
  }

  private determineStatus(
    tickets: TicketInfo[],
    hasEsgotado: boolean,
    hasComprar: boolean,
    hasDisponivel: boolean,
    hasBuyButton: boolean,
    hasSoldOutButton: boolean,
  ): { status: 'sold_out' | 'available'; availableTickets: TicketInfo[] } {
    if (tickets.length > 0) {
      const hasAvailable = tickets.some((t) => t.status === 'available');
      const allSoldOut = tickets.every((t) => t.status === 'sold_out');

      if (hasAvailable) {
        return {
          status: 'available',
          availableTickets: tickets.filter((t) => t.status === 'available'),
        };
      }

      if (allSoldOut) {
        return { status: 'sold_out', availableTickets: [] };
      }
    }

    if (hasBuyButton && !hasSoldOutButton) {
      return { status: 'available', availableTickets: [] };
    }

    if (hasComprar || hasDisponivel) {
      return { status: 'available', availableTickets: [] };
    }

    if (hasEsgotado || hasSoldOutButton) {
      return { status: 'sold_out', availableTickets: [] };
    }

    return { status: 'sold_out', availableTickets: [] };
  }

  private extractTicketName($el: cheerio.Cheerio<AnyNode>): string | undefined {
    for (const selector of NAME_SELECTORS) {
      const found = $el.find(selector).first().text().trim();
      if (found.length > 2) return found;
    }

    const directText = $el.contents().first().text().trim();
    if (directText.length > 2) return directText;

    return undefined;
  }

  private extractTicketStatus($el: cheerio.Cheerio<AnyNode>): TicketStatus {
    const text = $el.text().toLowerCase();

    if (/esgotado|indispon[ií]vel/i.test(text)) return 'sold_out';
    if (/dispon[ií]vel|comprar|garantir/i.test(text)) return 'available';

    const badges = $el.find(
      '[class*="badge"], [class*="status"], [class*="tag"], [class*="label"]',
    );
    const badgeText = badges.text().toLowerCase();
    if (/esgotado/i.test(badgeText)) return 'sold_out';
    if (/dispon[ií]vel/i.test(badgeText)) return 'available';

    const buttons = $el.find(
      'button, a[class*="btn"], [class*="button"], [class*="botao"]',
    );
    const disabledButton = buttons.filter(
      '[disabled], [class*="disabled"], [aria-disabled="true"]',
    );
    if (disabledButton.length > 0 && buttons.length > 0) return 'sold_out';

    const enabledButtons = buttons.filter(
      ':not([disabled]):not([class*="disabled"]):not([aria-disabled="true"])',
    );
    if (enabledButtons.length > 0) return 'available';

    return 'sold_out';
  }

  private extractPrice(
    $el: cheerio.Cheerio<AnyNode>,
  ): string | undefined {
    for (const selector of PRICE_SELECTORS) {
      const text = $el.find(selector).first().text().trim();
      if (text.length > 0 && /[Rr]\$|\d+[,.]\d+/.test(text)) {
        return text;
      }
    }
    return undefined;
  }

  private extractQuantity(
    $el: cheerio.Cheerio<AnyNode>,
  ): number | undefined {
    const text = $el.text();
    const match = text.match(/(\d+)\s*(restantes?|dispon[ií]veis?)/i);
    if (match !== null && match[1] !== undefined) {
      return Number.parseInt(match[1], 10);
    }
    return undefined;
  }
}
