import { requestStore } from '$lib/store.js';
import { json } from '@sveltejs/kit';

// GET /api/logs — return store entries directly so that selectedLog references
// stay live when the store mutates them in real-time during streaming.
export function GET() {
  const logs = requestStore.getAll();
  return json(logs);
}
