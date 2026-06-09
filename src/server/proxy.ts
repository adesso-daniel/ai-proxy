import { requestStore } from '$lib/store.js';
import { fetch } from 'undici';

const TRUNCATE_SIZE = 4096;

export async function handleProxyRequest(req: Request): Promise<Response> {
  const startTime = Date.now();
  const providerUrl = process.env.PROXY_PROVIDER_URL || "";

  const url = new URL(req.url);
  const path = url.pathname + url.search;
  const fullUrl = providerUrl + path;

  let responseBody: string | null = null;
  let requestBody: string | null = null;
  let error: string | null = null;
  let statusCode = 502;

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

    // Capture response body
    const respBuffer = await response.arrayBuffer();
    responseBody = bufferToString(respBuffer);

    // Create new response from the captured buffer
    // Convert undici Headers to HeadersInit (spread as object)
    const headersInit: Record<string, string> = {};
    for (const [key, value] of response.headers.entries()) {
      headersInit[key] = value;
    }
    return new Response(respBuffer, {
      status: response.status,
      statusText: response.statusText,
      headers: headersInit,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    statusCode = 502;
  }

  const duration = Date.now() - startTime;
  const requestSize = Buffer.byteLength(requestBody || '');
  const responseSize = Buffer.byteLength(responseBody || '');

  // Log to store (fire-and-forget)
  requestStore.add({
    method: req.method,
    url: req.url,
    path,
    providerUrl: fullUrl,
    statusCode,
    duration: Math.round(duration * 10) / 10,
    requestSize,
    responseSize,
    requestBody,
    responseBody,
    error,
  });

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
