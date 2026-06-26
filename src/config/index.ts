import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppConfig, EventDefinition } from '../types/index.js';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `Missing required environment variable: ${key}. Check your .env file.`,
    );
  }
  return value;
}

function intEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (typeof value !== 'string' || value.length === 0) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `Invalid integer value for ${key}: "${value}". Expected a number.`,
    );
  }
  return parsed;
}

function boolEnv(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (typeof value !== 'string' || value.length === 0) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}

export function loadConfig(): AppConfig {
  return {
    eventUrl: requireEnv('EVENT_URL'),
    botToken: requireEnv('BOT_TOKEN'),
    chatId: requireEnv('CHAT_ID'),
    headless: boolEnv('HEADLESS', true),
    checkInterval: intEnv('CHECK_INTERVAL', 60),
    startHour: intEnv('START_HOUR', 5),
    endHour: intEnv('END_HOUR', 23),
    timezone: process.env['TIMEZONE'] ?? 'America/Sao_Paulo',
  };
}

export function loadEvents(eventUrl?: string): EventDefinition[] {
  const eventsPath = resolve('events.json');
  if (existsSync(eventsPath)) {
    const content = readFileSync(eventsPath, 'utf-8');
    return JSON.parse(content) as EventDefinition[];
  }

  if (eventUrl !== undefined) {
    return [{ name: 'Evento', url: eventUrl }];
  }

  return [];
}
