import { requestStore } from '$lib/store.js';
import { fetch } from 'undici';

export async function handleProxyRequest(req: Request): Promise<Response> {
  const startTime = Date.now();
  const providerUrl = process.env.PROXY_PROVIDER_URL || "";

  const url = new URL(req.url);
  const path = url.pathname + url.search;
  const fullUrl = providerUrl + path;

  let requestBody: string | null = null;
  let requestBodySize = 0;
  let error: string | null = null;

  // Capture request body for logging
  const reqBuffer = await req.arrayBuffer();
  requestBody = bufferToString(reqBuffer);
  requestBodySize = Buffer.byteLength(requestBody || '');

  // Log request immediately (without awaiting the response)
  const logEntry = requestStore.start({
    method: req.method,
    url: req.url,
    path,
    providerUrl: fullUrl,
    requestSize: requestBodySize,
    requestBody
  });

  // Forward the request
  const forwardHeaders = new Headers(req.headers as HeadersInit);
  forwardHeaders.set('host', new URL(providerUrl).host);

  let response: any;
  try {
    response = await fetch(fullUrl, {
      method: req.method,
      headers: forwardHeaders as HeadersInit,
      body: reqBuffer.byteLength ? reqBuffer : undefined,
      duplex: 'half',
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    requestStore.finish(logEntry.id, {
      statusCode: 502,
      duration: Math.round((Date.now() - startTime) * 10) / 10,
      responseSize: 0,
      responseBody: null,
      error,
    });

    return new Response(JSON.stringify({ error }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Collect response body while streaming to the client in real-time
  const status = response.status;
  const statusText = response.statusText;
  const respHeaders: Record<string, string> = {};
  for (const [key, value] of response.headers.entries()) {
    respHeaders[key] = value;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let readError: string | null = null;

  const bodyStream = response.body;
  if (!bodyStream) {
    // No body — finish immediately
    requestStore.finish(logEntry.id, {
      statusCode: status,
      duration: Math.round((Date.now() - startTime) * 10) / 10,
      responseSize: 0,
      responseBody: null,
      error: null,
    });
    return new Response(null, {
      status,
      statusText,
      headers: respHeaders,
    });
  }

  // Tee the stream: one branch goes to the client (real-time),
  // the other branch collects chunks for logging
  const [clientStream, loggingStream] = bodyStream.tee();

  // Read from the logging branch to collect chunks for the full response body
  // Use .catch() to handle errors gracefully — log is updated even on failure
  const collectChunks = (async () => {
    try {
      const reader = loggingStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalBytes += value.byteLength;
      }
    } catch (err) {
      readError = err instanceof Error ? err.message : String(err);
    }
  })().then(

    () => {
      requestStore.finish(logEntry.id, {
        statusCode: status,
        duration: Math.round((Date.now() - startTime) * 10) / 10,
        responseSize: totalBytes,
        responseBody: bufferFromChunks(chunks),
        error: readError,
      });
    },
    (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      requestStore.finish(logEntry.id, {
        statusCode: status,
        duration: Math.round((Date.now() - startTime) * 10) / 10,
        responseSize: totalBytes,
        responseBody: bufferFromChunks(chunks),
        error: msg,
      });
    },
  );

  // Return the client branch immediately — data streams in real-time
  return new Response(clientStream, {
    status,
    statusText,
    headers: respHeaders,
  });
}

function bufferToString(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

function bufferFromChunks(chunks: Uint8Array[]): string {
  if (chunks.length === 0) return '';
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return bufferToString(combined.buffer);
}
