# Plan: Incremental Streaming Logs + Multi-Object Modal Parsing

## Problem

1. **Logs don't update during streaming** — The stream is already tee'd to the client in real-time, but `requestStore.finish()` is only called after the entire stream completes. The log stays as "pending" with `responseBody: null` until done, so the user sees nothing useful during streaming.

2. **Modal can't parse multi-object responses** — SSE/streaming `responseBody` contains multiple concatenated JSON objects. The modal does a single `JSON.parse(content)` which fails.

## Proposed Architecture

### New: `updateResponse()` method in store

Add an `updateResponse(id, params)` method that pushes partial body content as chunks arrive. The log entry's status transitions through:

```
pending → streaming → completed
```

During `streaming`, the log card shows a live indicator (spinning dot or "streaming…" badge) and the partial `responseBody` content in expanded view.

## Implementation Changes

### File 1: `src/lib/store.ts`

1. **Add `'streaming'` status** (change union from `'pending' | 'completed' | 'error'` to `'pending' | 'streaming' | 'completed' | 'error'`)
2. **Add `updateResponse(id, params)` method:**
   - Accepts partial `responseBody` and optional `responseSize`
   - Sets status to `'streaming'`
   - Only allowed if entry is currently `'pending'`
   - Appends body text to existing `responseBody` (string concatenation)
3. **Update `finish()` to accept `'streaming'` status** (transition from either `'pending'` or `'streaming'` → `'completed'`/`'error'`)

### File 2: `src/lib/types.ts`

Update `RequestLog.status` union: `'pending' | 'streaming' | 'completed' | 'error'`

### File 3: `src/server/proxy.ts`

Change the chunk collection loop to call `updateResponse()` incrementally:

```ts
const collectChunks = (async () => {
  const reader = loggingStream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalBytes += value.byteLength;
    
    // Push partial body to the log in real-time
    const partialBody = bufferFromChunks(chunks);
    requestStore.updateResponse(logEntry.id, {
      responseBody: partialBody,
      responseSize: totalBytes,
    });
  }
})()
.then(() => {
  // ...existing finish call, status will already be 'streaming'
});
```

### File 4: `src/routes/+page.svelte`

#### 4a. Streaming status UI

- **Log row:** Add a `'streaming'` state between pending and completed
  - Visual: spinning indicator (similar to the polling dot animation, maybe amber color)
  - Color: amber/orange (`#f59e0b`) to sit between pending yellow and completed green
  - Text: "streaming…" instead of "pending" or status code
- **Expanded log view:** When `responseBody` exists (even partial), show a truncated preview snippet below the URL, similar to how `requestBody` preview works

#### 4b. Multi-object modal parsing

1. **Add `parseResponseBody(raw: string): string[]` utility:**
   - Try `JSON.parse(raw)` first → return `[formattedJsonString]`
   - Otherwise, split by newlines, `JSON.parse` each non-empty line → return array of formatted strings
   - Track lines that fail to parse (return `{ objects: string[], errors: number }` or similar)

2. **Update `bodyModal` type:**
   ```ts
   let bodyModal = $state<{
     type: "requestBody" | "responseBody";
     content: string | string[];   // string = single object, string[] = multi-object
     title: string;
     objectCount?: number;
     parseErrors?: number;
   } | null>(null);
   ```

3. **Update `openBodyModal` for `responseBody`:**
   - Run `parseResponseBody(content)`, store the array
   - Set `objectCount` and `parseErrors` from the result

4. **Update modal rendering:**
   - If `content` is an array → render each object as a separate pretty-printed block
   - Show object count header (e.g., "5 stream chunks")
   - Each chunk labeled with index (1, 2, 3…)
   - If `parseErrors > 0`, show a warning (e.g., "3 lines couldn't be parsed as JSON")
   - Pretty-print each object individually using `prettyPrintJson.toHtml`

5. **Update copy button:**
   - If content is an array, join with newlines to reconstruct the original format
   - If string, copy as-is

## State Transitions

```
pending  ──[stream starts, body received]──> streaming ──[stream ends]──> completed
                                                    │
                                                    └──[error]──> error
```

## Edge Cases

| Case | Handling |
|------|----------|
| Non-streaming single response | `parseResponseBody` returns single-element array; modal looks the same |
| Empty response body | Show "No body" message |
| Mixed valid/invalid JSON lines | Show error count (e.g., "2 chunks failed to parse") |
| Very large number of chunks | Consider lazy rendering (NFR) |
| `updateResponse` on non-pending entry | Guard: only allow if status is `'pending'` or `'streaming'` |

## Implementation Order

1. ✅ **`types.ts`** — Add `'streaming'` to status union
2. ✅ **`store.ts`** — Add `'streaming'` status, `updateResponse()` method, update `finish()`
3. ✅ **`proxy.ts`** — Call `updateResponse()` incrementally in chunk collection loop
4. ✅ **`+page.svelte`** — Add streaming status UI (color, indicator, text) in log row
5. ✅ **`+page.svelte`** — Add streaming partial body preview in expanded view
6. ✅ **`+page.svelte`** — Add `parseResponseBody` utility
7. ✅ **`+page.svelte`** — Update modal type, `openBodyModal`, and rendering for multi-object
   - Modal now renders each chunk with labeled headers ("Chunk 1", "Chunk 2", etc.)
   - Shows chunk count in modal header
   - Shows parse error warnings
   - Handles empty body case
   - Falls back to single-content for non-streaming responses
8. ✅ **`+page.svelte`** — Update copy button for array content
   - Uses `copyBodyContent()` helper to properly join array with newlines

## Implementation Notes

- CSS classes added for multi-chunk modal: `modal-chunk`, `chunk-header`, `chunk-index`, `chunk-separator`, `chunk-content`, `parse-error`, `empty-body`, `modal-subtitle`
- CSS classes added for streaming indicators: `streaming-indicator` (rotating spinner), `streaming-chunks` (pulsing "streaming" text)

## Outstanding Issues / TODO

### Modal doesn't parse streaming response bodies

**Symptom**: Every response body modal shows "xxx lines couldn't be parsed as JSON" with zero objects.

**Root cause**: `parseResponseBody` only splits raw text by `\n` and tries `JSON.parse` on each line. Streaming responses come in formats that don't split this way:

| Format | Example | Why it fails |
|--------|---------|-------------|
| SSE | `data: {"id":"1","delta":{"text":"hello"}}\n` | Line starts with `data: ` prefix — not valid JSON |
| Concatenated | `{"id":"1"}{"id":"2"}` | No newline separator — entire blob treated as one line |
| `[DONE]` sentinel | `data: [DONE]` | `[DONE]` is not valid JSON |
| Mixed | `data: {"id":"1"}\n{"id":"2"}` | SSE lines fail, plain JSON lines work |

**Fix implemented**: Two-tier extraction strategy in `parseResponseBody`:

1. **Strategy A — `extractJsonObjects()`**: Split by newlines, strip `data: ` prefix (handles `data:{` and `data: {`), skip `[DONE]` sentinel, parse each cleaned line.
2. **Strategy B — `extractByBraces()`**: If Strategy A finds nothing, use brace-matching to extract JSON objects from concatenated text (`{"a":1}{"b":2}`).
3. Falls back to error counting only if no objects found.

**Files changed**: `src/routes/+page.svelte` — `parseResponseBody`, new `extractJsonObjects`, new `extractByBraces`

**Status**: Implemented and tested against all common streaming formats (SSE, concatenated, newline-separated, mixed).
