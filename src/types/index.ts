export type TicketStatus = 'available' | 'sold_out';

export type MonitorStatus = TicketStatus | 'error';

export interface TicketInfo {
  name: string;
  status: TicketStatus;
  price?: string;
  quantityRemaining?: number;
}

export interface WatcherResult {
  status: MonitorStatus;
  eventName: string;
  eventUrl: string;
  availableTickets: TicketInfo[];
  checkedAt: string;
  executionTimeMs: number;
  error?: string;
  strategiesUsed: string[];
}

export interface AppState {
  status: MonitorStatus;
  lastChecked: string;
  lastNotification: string | null;
  availableTickets: TicketInfo[];
}

export interface AppConfig {
  eventUrl: string;
  botToken: string;
  chatId: string;
  headless: boolean;
  checkInterval: number;
  startHour: number;
  endHour: number;
  timezone: string;
}

export interface EventDefinition {
  name: string;
  url: string;
}
