import { requestStore } from '$lib/store.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// GET /api/logs/[id] — return full detail for a specific request
export const GET: RequestHandler = async ({ params }) => {
  const log = requestStore.getById(params.id);

  if (!log) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  return json(log);
};
