export interface RequestLog {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  path: string;
  providerUrl: string;
  statusCode?: number;
  duration?: number;
  requestSize: number;
  responseSize?: number;
  requestBody: string | null;
  responseBody: string | null;
  responseReasoning: string | null;
  responseDisplayEntries?: Array<
    | { type: 'json'; html: string }
    | { type: 'reasoning'; content: string }
  >;
  hasDisplayEntries: boolean;
  error: string | null;
  status: 'pending' | 'streaming' | 'completed' | 'error';
}

export interface RequestLogCompact
  extends Omit<RequestLog, 'requestBody' | 'responseBody' | 'statusCode' | 'duration' | 'responseSize' | 'responseDisplayEntries' | 'hasDisplayEntries'> {
  requestBody: string | null;
  responseBody: string | null;
  responseReasoning: string | null;
  hasDisplayEntries: boolean;
  statusCode?: number;
  duration?: number;
  responseSize?: number;
}
