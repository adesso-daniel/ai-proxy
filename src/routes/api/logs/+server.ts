import { requestStore } from '$lib/store.js';
import type { RequestLog } from '$lib/types.js';
import { json } from '@sveltejs/kit';

// GET /api/logs — return compact list (no full bodies)
export function GET() {
  const logs: RequestLog[] = requestStore.getAll();

  // Return compact version (still includes truncated bodies as per spec)
  return json(
    logs.map((log) => ({
      id: log.id,
      timestamp: log.timestamp,
      method: log.method,
      url: log.url,
      path: log.path,
      providerUrl: log.providerUrl,
      statusCode: log.statusCode,
      duration: log.duration,
      requestSize: log.requestSize,
      responseSize: log.responseSize,
      requestBody: log.requestBody,
      responseBody: log.responseBody,
      error: log.error,
    })),
  );
}
