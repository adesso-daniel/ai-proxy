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

  // Accumulated raw text and incremental reasoning, updated in real-time as chunks arrive
  let accumulatedRaw = '';
  let reasoningAccum = '';
  let lastExtractedCount = 0;

  const bodyStream = response.body;
  if (!bodyStream) {
    // No body — finish immediately
    requestStore.finish(logEntry.id, {
      statusCode: status,
      duration: Math.round((Date.now() - startTime) * 10) / 10,
      responseSize: 0,
      responseBody: null,
      responseReasoning: null,
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

        // Rebuild accumulated raw text
        accumulatedRaw = bufferFromChunks(chunks);

        // Extract only NEW JSON objects (not re-parsing previously seen ones)
        const { reasoning: newReasoning } = parseNewObjects(accumulatedRaw, lastExtractedCount);
        lastExtractedCount = extractJsonObjects(accumulatedRaw).length;

        if (newReasoning) {
          reasoningAccum += newReasoning;
        }

        // Push partial body to the log in real-time
        const partialBody = accumulatedRaw;
        requestStore.updateResponse(logEntry.id, {
          responseBody: partialBody,
          responseReasoning: reasoningAccum,
          responseSize: totalBytes,
        });
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
        responseReasoning: reasoningAccum || null,
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
        responseReasoning: reasoningAccum || null,
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

/**
 * Parse only NEW JSON objects (from startIdx onward) and extract reasoning content.
 * Returns concatenated reasoning text from the new objects.
 */
function parseNewObjects(raw: string, startIdx: number): { reasoning: string } {
  const extracted = extractJsonObjects(raw);
  const reasoningParts: string[] = [];

  // Process only new objects (starting from startIdx)
  for (let i = startIdx; i < extracted.length; i++) {
    const obj = extracted[i];

    if (isRecord(obj) && 'choices' in obj && Array.isArray(obj.choices)) {
      // Extract (reasoning_)content from OpenAI-compatible streaming responses
      for (const choice of obj.choices) {
        if (isRecord(choice) && choice.delta && isRecord(choice.delta)) {
          const reasoning = choice.delta.reasoning_content || choice.delta.content;
          if (typeof reasoning === 'string' && reasoning.trim()) {
            reasoningParts.push(reasoning);
            break; // Found reasoning in this object, move to next object
          }
        }
      }
    }
  }

  return { reasoning: reasoningParts.join('\n\n') };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extract JSON objects from raw streaming response text.
 * Handles multiple formats: SSE, newline-separated, concatenated, mixed.
 */
function extractJsonObjects(raw: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];

  // Strategy 1: Split by newlines, strip SSE prefix, parse each line
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip SSE sentinel values
    if (trimmed === '[DONE]' || trimmed === 'data: [DONE]') continue;

    // Strip SSE "data: " prefix
    const jsonLine = trimmed.replace(/^data:\s*/, '');
    if (!jsonLine) continue;

    try {
      const parsed = JSON.parse(jsonLine);
      results.push(parsed);
      continue;
    } catch {
      // fall through to next strategy
    }
  }

  // Strategy 2: If no objects found, try extracting JSON objects using brace matching
  if (results.length === 0) {
    const extracted = extractByBraces(raw);
    if (extracted.length > 0) {
      return extracted;
    }
  }

  return results;
}

/**
 * Extract JSON objects from concatenated text using brace matching.
 */
function extractByBraces(raw: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{' && depth === 0) {
      start = i;
    }
    if (ch === '{') depth++;
    if (ch === '}') depth--;

    if (depth === 0 && start !== -1) {
      const slice = raw.slice(start, i + 1);
      try {
        results.push(JSON.parse(slice));
      } catch {
        // Not valid JSON at this boundary, reset
      }
      start = -1;
    }
  }

  return results;
}
