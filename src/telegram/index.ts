import { logger } from '../logger/index.js';

interface TicketDisplay {
  name: string;
  price?: string;
  quantityRemaining?: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id: number };
  };
}

interface TelegramResponse {
  ok: boolean;
  result?: TelegramUpdate[];
}

export type CommandHandler = () => Promise<string>;

export class TelegramNotifier {
  private readonly chatId: string;
  private readonly apiBase: string;
  private readonly commandHandlers: Map<string, CommandHandler> = new Map();
  private lastUpdateId: number = 0;
  private pollingActive: boolean = false;
  private pollingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(botToken: string, chatId: string) {
    this.chatId = chatId;
    this.apiBase = `https://api.telegram.org/bot${botToken}`;
  }

  setCommandHandler(command: string, handler: CommandHandler): void {
    const normalized = command.startsWith('/') ? command : `/${command}`;
    this.commandHandlers.set(normalized.toLowerCase(), handler);
    logger.info('Command handler registered', { command: normalized });
  }

  async sendMessage(text: string, targetChatId?: string): Promise<boolean> {
    const start = performance.now();
    try {
      const chatId = targetChatId ?? this.chatId;
      const url = `${this.apiBase}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unknown error');
        throw new Error(`Telegram API error ${response.status}: ${errorBody}`);
      }

      const duration = performance.now() - start;
      logger.info('Telegram message sent', { durationMs: Math.round(duration) });
      return true;
    } catch (error) {
      logger.error('Failed to send Telegram message', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  buildAvailabilityMessage(
    eventName: string,
    eventUrl: string,
    tickets: TicketDisplay[],
  ): string {
    const now = new Date();
    const formattedTime = now.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'medium',
    });

    const lines: string[] = [
      '🎟️ <b>MO INGRESSO DISPONÍVEL! CORRE!</b> 🎟️',
      '',
      'Mozoila, encontrei ingressos! 💕',
      '',
      `Evento: <b>${this.escapeHtml(eventName)}</b>`,
      '',
      'Foi detectada disponibilidade de ingresso.',
      '',
    ];

    if (tickets.length > 0) {
      lines.push('📋 <b>Lotes disponíveis:</b>');
      for (const ticket of tickets) {
        let ticketLine = `  • ${this.escapeHtml(ticket.name)}`;
        if (ticket.price !== undefined) {
          ticketLine += ` - ${ticket.price}`;
        }
        if (ticket.quantityRemaining !== undefined) {
          ticketLine += ` (${ticket.quantityRemaining} restantes)`;
        }
        lines.push(ticketLine);
      }
      lines.push('');
    }

    lines.push(`⏰ ${formattedTime}`);
    lines.push('');
    lines.push(`🔗 <a href="${this.escapeHtml(eventUrl)}">Abrir página do evento</a>`);
    lines.push('');
    lines.push('💬 Comandos: /status /check');

    return lines.join('\n');
  }

  startPolling(): void {
    if (this.pollingActive) return;
    this.pollingActive = true;
    logger.info('Starting Telegram command polling');
    this.pollLoop();
  }

  stopPolling(): void {
    this.pollingActive = false;
    if (this.pollingTimer !== null) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
    logger.info('Telegram command polling stopped');
  }

  private async pollLoop(): Promise<void> {
    if (!this.pollingActive) return;

    try {
      await this.fetchAndProcessUpdates();
    } catch (error) {
      logger.error('Telegram polling error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (this.pollingActive) {
      this.pollingTimer = setTimeout(() => {
        this.pollLoop().catch((err) => {
          logger.error('Poll loop rethrow', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, 3000);
    }
  }

  private async fetchAndProcessUpdates(): Promise<void> {
    const url = `${this.apiBase}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=30`;
    const response = await fetch(url);
    const data = (await response.json()) as TelegramResponse;

    if (!data.ok || data.result === undefined) return;

    for (const update of data.result) {
      this.lastUpdateId = update.update_id;
      await this.processUpdate(update);
    }
  }

  private async processUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (msg === undefined) return;

    const text = msg.text ?? '';
    const chatId = msg.chat?.id;
    if (chatId === undefined) return;

    if (chatId.toString() !== this.chatId) return;

    if (!text.startsWith('/')) return;

    const command = text.split(' ')[0]?.toLowerCase() ?? '';
    const handler = this.commandHandlers.get(command);

    if (handler !== undefined) {
      logger.info('Processing command', { command, from: chatId });
      const reply = await handler();
      await this.sendMessage(reply, chatId.toString());
    } else {
      await this.sendMessage(
        `Comando não reconhecido: ${command}\n\nComandos disponíveis:\n/start - Mensagem de boas-vindas\n/status - Status atual dos ingressos\n/check - Verificar manualmente agora`,
        chatId.toString(),
      );
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
