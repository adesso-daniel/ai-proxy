import type { Handle } from '@sveltejs/kit';
import { handleProxyRequest } from './server/proxy.js';

export const handle: Handle = async ({ event, resolve }) => {
	const url = new URL(event.url);

	// Intercept all /v1/** requests and forward to the provider
	if (url.pathname.startsWith('/v1/')) {
		return handleProxyRequest(event.request);
	}

	// Let SvelteKit handle the rest (dashboard, API endpoints)
	return resolve(event);
};
