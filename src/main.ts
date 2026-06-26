import { loadConfig } from './config/index.js';
import { logger } from './logger/index.js';
import { TelegramNotifier } from './telegram/index.js';
import type { CommandHandler } from './telegram/index.js';
import { loadState, saveState } from './storage/index.js';
import { BrowserManager } from './watchers/browser.manager.js';
import { SymplaWatcher } from './watchers/sympla.watcher.js';
import { Scheduler, buildCronExpression } from './scheduler/index.js';
import { randomJitter, formatDuration } from './utils/index.js';
import type { WatcherResult } from './types/index.js';

async function handleCheckResult(
  result: WatcherResult,
  telegram: TelegramNotifier,
): Promise<void> {
  const state = loadState();
  const prevStatus = state.status;

  state.lastChecked = result.checkedAt;

  if (result.status === 'error') {
    state.status = 'error';
    saveState(state);
    logger.error('Check resulted in error', {
      error: result.error,
      url: result.eventUrl,
    });
    return;
  }

  logger.info('Check completed', {
    status: result.status,
    event: result.eventName,
    ticketsAvailable: result.availableTickets.length,
    duration: formatDuration(result.executionTimeMs),
    strategies: result.strategiesUsed,
  });

  const becameAvailable = result.status === 'available' && prevStatus !== 'available';
  const becameSoldOut = result.status === 'sold_out' && prevStatus === 'available';

  if (becameAvailable) {
    logger.info('Status changed to available, sending notification', {
      from: prevStatus,
      to: result.status,
    });

    const message = telegram.buildAvailabilityMessage(
      result.eventName,
      result.eventUrl,
      result.availableTickets,
    );

    const sent = await telegram.sendMessage(message);
    if (sent) {
      state.lastNotification = result.checkedAt;
    }
  }

  if (becameSoldOut) {
    logger.info('Status changed back to sold out, notification reset', {
      from: prevStatus,
      to: result.status,
    });
  }

  if (prevStatus !== result.status && !becameAvailable && !becameSoldOut) {
    logger.info('Status changed', { from: prevStatus, to: result.status });
  }

  state.status = result.status;
  state.availableTickets = result.availableTickets;
  saveState(state);
}

async function main(): Promise<void> {
  const isOneShot = process.argv.includes('--once');
  const config = loadConfig();

  logger.info('Starting Sympla Ticket Monitor', {
    version: '1.0.0',
    eventUrl: config.eventUrl,
    headless: config.headless,
    timezone: config.timezone,
    schedule: `${String(config.startHour).padStart(2, '0')}:00 - ${String(config.endHour).padStart(2, '0')}:00`,
    interval: `${config.checkInterval}s`,
    mode: isOneShot ? 'one-shot' : 'continuous',
  });

  const telegram = new TelegramNotifier(config.botToken, config.chatId);
  const browserManager = new BrowserManager(config);

  try {
    await browserManager.start();
  } catch (error) {
    logger.error('Failed to start browser, exiting', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  const watcher = new SymplaWatcher(config.eventUrl, browserManager);

  async function performCheck(): Promise<void> {
    await randomJitter(5, 20);
    const start = performance.now();

    try {
      logger.info('Running check...', { url: config.eventUrl });
      const result = await watcher.check();
      await handleCheckResult(result, telegram);
    } catch (error) {
      logger.error('Unexpected error during check cycle', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const elapsed = formatDuration(performance.now() - start);
    logger.debug('Check cycle finished', { totalTime: elapsed });
  }

  async function performForcedCheck(): Promise<string> {
    logger.info('Running forced check via command');
    const start = performance.now();

    try {
      const result = await watcher.check();
      await handleCheckResult(result, telegram);

      const statusEmoji = result.status === 'available' ? '✅' : '❌';
      const elapsed = formatDuration(performance.now() - start);

      let msg =
        `${statusEmoji} <b>Verificação concluída!</b>\n\n` +
        `Status: <b>${result.status === 'available' ? 'DISPONÍVEL' : 'ESGOTADO'}</b>\n` +
        `Evento: ${result.eventName}\n` +
        `Tempo: ${elapsed}\n` +
        `Estratégias: ${result.strategiesUsed.join(', ')}`;

      if (result.status === 'available' && result.availableTickets.length > 0) {
        msg += '\n\n📋 <b>Lotes:</b>\n';
        for (const ticket of result.availableTickets) {
          msg += `  • ${ticket.name}`;
          if (ticket.price !== undefined) msg += ` - ${ticket.price}`;
          msg += '\n';
        }
      }

      return msg;
    } catch (error) {
      return `❌ <b>Erro na verificação:</b>\n${error instanceof Error ? error.message : String(error)}`;
    }
  }

  if (isOneShot) {
    logger.info('Running one-shot check');
    await performCheck();
    await browserManager.stop();
    logger.info('One-shot check completed');
    return;
  }

  performCheck();

  const cronExpression = buildCronExpression(config.checkInterval);
  const scheduler = new Scheduler();

  scheduler.start(
    cronExpression,
    performCheck,
    config.startHour,
    config.endHour,
    config.timezone,
  );

  const startHandler: CommandHandler = async () => {
    return (
      '💖 <b>Oi, meus nenéns!</b>\n\n' +
      'Eu sou o monitor de ingressos da Sympla!\n' +
      'Fico de olho no show do Dubdogz 24/7 pra vocês.\n\n' +
      'Quando algum ingresso aparecer, eu aviso na hora! 🎟️\n\n' +
      '<b>Comandos:</b>\n' +
      '/status - Ver status atual\n' +
      '/check - Forçar verificação manual'
    );
  };

  const statusHandler: CommandHandler = async () => {
    const state = loadState();
    const statusEmoji = state.status === 'available' ? '✅' : state.status === 'error' ? '⚠️' : '❌';
    const statusText = state.status === 'available' ? 'DISPONÍVEL' : state.status === 'error' ? 'ERRO' : 'ESGOTADO';
    const lastCheck = new Date(state.lastChecked).toLocaleString('pt-BR', {
      timeZone: config.timezone,
      dateStyle: 'short',
      timeStyle: 'medium',
    });
    const lastNotif = state.lastNotification !== null
      ? new Date(state.lastNotification).toLocaleString('pt-BR', {
          timeZone: config.timezone,
          dateStyle: 'short',
          timeStyle: 'medium',
        })
      : 'Nenhuma ainda';

    return (
      `${statusEmoji} <b>Status: ${statusText}</b>\n\n` +
      `🎫 Evento: Dubdogz na Copa\n` +
      `🕐 Última verificação: ${lastCheck}\n` +
      `📨 Última notificação: ${lastNotif}\n\n` +
      `📋 Ingressos disponíveis: ${state.availableTickets.length}`
    );
  };

  const checkHandler: CommandHandler = async () => {
    return await performForcedCheck();
  };

  telegram.setCommandHandler('/start', startHandler);
  telegram.setCommandHandler('/status', statusHandler);
  telegram.setCommandHandler('/check', checkHandler);
  telegram.startPolling();

  async function shutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    scheduler.stop();
    telegram.stopPolling();
    await browserManager.stop();
    logger.info('Shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.info('Application is running');
}

main().catch((error) => {
  logger.error('Fatal error', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
