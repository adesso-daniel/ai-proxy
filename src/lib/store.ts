import type { RequestLog } from './types.js';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('1234567890abcdef', 12);

const TRUNCATE_SIZE = 4096;
const MAX_SIZE = 1000;

class RequestStore {
  private entries: Map<string, RequestLog> = new Map();

  add(log: Omit<RequestLog, 'id' | 'timestamp'>): RequestLog {
    const id = nanoid();
    const timestamp = Date.now();
    const entry: RequestLog = {
      id,
      timestamp,
      ...log,
      requestBody: log.requestBody ? truncate(log.requestBody, TRUNCATE_SIZE) : null,
      responseBody: log.responseBody ? truncate(log.responseBody, TRUNCATE_SIZE) : null,
    };
    this.entries.set(id, entry);

    // Evict oldest if over max
    if (this.entries.size > MAX_SIZE) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey) {
        this.entries.delete(oldestKey);
      }
    }

    return entry;
  }

  getAll(): RequestLog[] {
    return Array.from(this.entries.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getById(id: string): RequestLog | undefined {
    return this.entries.get(id);
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + `\n... (truncated, ${str.length} chars total)`;
}

export const requestStore = new RequestStore();
