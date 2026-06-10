import { requestStore } from '$lib/store.js';
import { fetch } from 'undici';

export async function handleProxyRequest(req: Request): Promise<Response> {
  const startTime = Date.now();
  const providerUrl = process.env.PROXY_PROVIDER_URL || "";

  const url = new URL(req.url);
  const path = url.pathname + url.search;
  const fullUrl = providerUrl + path;

  let responseBody: string | null = null;
  let responseBodyBytes: number = 0;
  let responseBuffer: ArrayBuffer | null = null;
  let requestBody: string | null = null;
  let error: string | null = null;
  let statusCode = 502;
  let respHeaders: Record<string, string> = {};
  let respStatusText = '';

  try {
    // Capture request body for logging
    const reqBuffer = await req.arrayBuffer();
    requestBody = bufferToString(reqBuffer);

    // Forward the request
    const forwardHeaders = new Headers(req.headers as HeadersInit);
    forwardHeaders.set('host', new URL(providerUrl).host);

    const response = await fetch(fullUrl, {
      method: req.method,
      headers: forwardHeaders as HeadersInit,
      body: reqBuffer.byteLength ? reqBuffer : undefined,
      duplex: 'half',
    });

    statusCode = response.status;
    respStatusText = response.statusText;

    // Capture headers before consuming the body
    respHeaders = {};
    for (const [key, value] of response.headers.entries()) {
      respHeaders[key] = value;
    }

    // Capture response body (raw buffer + string copy for logging)
    responseBuffer = await response.arrayBuffer();
    responseBodyBytes = responseBuffer.byteLength;
    responseBody = bufferToString(responseBuffer);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    statusCode = 502;
  }

  const duration = Date.now() - startTime;
  const requestSize = Buffer.byteLength(requestBody || '');

  // Log to store (fire-and-forget) — runs for both success and error
  requestStore.add({
    method: req.method,
    url: req.url,
    path,
    providerUrl: fullUrl,
    statusCode,
    duration: Math.round(duration * 10) / 10,
    requestSize,
    responseSize: responseBodyBytes,
    requestBody,
    responseBody,
    error,
  });

  // Return appropriate response to the client
  if (!error && responseBuffer !== null) {
    return new Response(responseBuffer, {
      status: statusCode,
      statusText: respStatusText,
      headers: respHeaders,
    });
  }

  // Error case — return JSON error
  return new Response(JSON.stringify({ error }), {
    status: 502,
    headers: { 'content-type': 'application/json' },
  });
}

function bufferToString(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}
