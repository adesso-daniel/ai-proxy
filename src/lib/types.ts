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
  error: string | null;
  status: 'pending' | 'streaming' | 'completed' | 'error';
}

export interface RequestLogCompact
  extends Omit<RequestLog, 'requestBody' | 'responseBody' | 'statusCode' | 'duration' | 'responseSize'> {
  requestBody: string | null;
  responseBody: string | null;
  responseReasoning: string | null;
  statusCode?: number;
  duration?: number;
  responseSize?: number;
}
