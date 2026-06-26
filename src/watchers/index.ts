import type { WatcherResult } from '../types/index.js';

export interface Watcher {
  check(): Promise<WatcherResult>;
}

export type { WatcherResult };
