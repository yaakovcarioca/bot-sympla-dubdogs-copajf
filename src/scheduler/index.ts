import cron from 'node-cron';
import { logger } from '../logger/index.js';

export function buildCronExpression(intervalSeconds: number): string {
  if (intervalSeconds < 60) {
    throw new Error(
      `Interval of ${intervalSeconds}s is below minimum of 60s for cron scheduling.`,
    );
  }

  const minutes = Math.floor(intervalSeconds / 60);

  if (minutes === 1) {
    return '* * * * *';
  }

  return `*/${minutes} * * * *`;
}

export class Scheduler {
  private task: cron.ScheduledTask | null = null;
  private tickCount: number = 0;
  private skippedCount: number = 0;

  start(
    expression: string,
    callback: () => Promise<void>,
    startHour: number,
    endHour: number,
    timezone: string,
  ): void {
    logger.info('Starting scheduler', {
      expression,
      timezone,
      window: `${String(startHour).padStart(2, '0')}:00 - ${String(endHour).padStart(2, '0')}:00`,
    });

    this.task = cron.schedule(
      expression,
      () => {
        this.tickCount++;
        if (!this.isWithinWindow(startHour, endHour, timezone)) {
          this.skippedCount++;
          return;
        }

        callback().catch((error) => {
          logger.error('Scheduled check failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      },
      {
        scheduled: true,
        timezone,
      },
    );

    logger.info('Scheduler started');
  }

  stop(): void {
    if (this.task !== null) {
      this.task.stop();
      this.task = null;
      logger.info('Scheduler stopped', {
        totalTicks: this.tickCount,
        skippedOutsideWindow: this.skippedCount,
      });
    }
  }

  private isWithinWindow(
    startHour: number,
    endHour: number,
    timezone: string,
  ): boolean {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
      });
      const hour = Number.parseInt(formatter.format(now), 10);
      return hour >= startHour && hour < endHour;
    } catch {
      const hour = new Date().getHours();
      return hour >= startHour && hour < endHour;
    }
  }
}
