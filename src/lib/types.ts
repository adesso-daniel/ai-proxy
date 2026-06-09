export interface RequestLog {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  path: string;
  providerUrl: string;
  statusCode: number;
  duration: number;
  requestSize: number;
  responseSize: number;
  requestBody: string | null;
  responseBody: string | null;
  error: string | null;
}

export interface RequestLogCompact extends Omit<RequestLog, 'requestBody' | 'responseBody'> {
  requestBody: string | null;
  responseBody: string | null;
}
