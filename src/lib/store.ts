import type { RequestLog } from './types.js';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('1234567890abcdef', 12);

const MAX_SIZE = 1000;

type StartParams = Omit<RequestLog, 'id' | 'timestamp' | 'status' | 'responseBody' | 'responseSize' | 'statusCode' | 'duration' | 'error'>;
type FinishParams = Pick<RequestLog, 'statusCode' | 'duration' | 'responseSize' | 'responseBody' | 'error'>;

class RequestStore {
  private entries: Map<string, RequestLog> = new Map();

  start(params: StartParams): RequestLog {
    const id = nanoid();
    const timestamp = Date.now();
    const entry: RequestLog = {
      id,
      timestamp,
      ...params,
      requestBody: params.requestBody,
      responseBody: null,
      statusCode: undefined,
      duration: undefined,
      responseSize: undefined,
      error: null,
      status: 'pending',
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

  finish(id: string, params: FinishParams): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    if (params.error) {
      entry.status = 'error';
    } else {
      entry.status = 'completed';
    }
    entry.statusCode = params.statusCode;
    entry.duration = params.duration;
    entry.responseSize = params.responseSize;
    entry.responseBody = params.responseBody;
    entry.error = params.error;
  }

  getAll(): RequestLog[] {
    return Array.from(this.entries.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getById(id: string): RequestLog | undefined {
    return this.entries.get(id);
  }
}

export const requestStore = new RequestStore();
