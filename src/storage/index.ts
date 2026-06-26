import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppState, MonitorStatus, TicketInfo } from '../types/index.js';
import { logger } from '../logger/index.js';

const DATA_DIR = resolve('data');
const STATE_FILE = resolve(DATA_DIR, 'state.json');

const DEFAULT_STATE: AppState = {
  status: 'sold_out',
  lastChecked: new Date(0).toISOString(),
  lastNotification: null,
  availableTickets: [],
};

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadState(): AppState {
  try {
    ensureDataDir();
    if (!existsSync(STATE_FILE)) {
      return { ...DEFAULT_STATE };
    }
    const content = readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(content) as Partial<AppState>;
    return {
      status: parsed.status ?? DEFAULT_STATE.status,
      lastChecked: parsed.lastChecked ?? DEFAULT_STATE.lastChecked,
      lastNotification: parsed.lastNotification ?? DEFAULT_STATE.lastNotification,
      availableTickets: parsed.availableTickets ?? DEFAULT_STATE.availableTickets,
    };
  } catch (error) {
    logger.warn('Failed to load state file, using defaults', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...DEFAULT_STATE };
  }
}

export function saveState(state: AppState): void {
  try {
    ensureDataDir();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    logger.error('Failed to save state file', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function stateFileExists(): boolean {
  return existsSync(STATE_FILE);
}

export { type AppState, type MonitorStatus, type TicketInfo };
