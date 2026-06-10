import type { Handle } from '@sveltejs/kit';
import { handleProxyRequest } from './server/proxy.js';

export const handle: Handle = async ({ event, resolve }) => {
	const url = new URL(event.url);

	// Do not proxy SvelteKit's own routes — let them through to the dashboard/API.
	// This includes the dashboard root (/), API endpoints (/api/**), and
	// SvelteKit internal assets (/_/**).
	const path = url.pathname;
	if (
		path === '/' ||
		path.startsWith('/api/logs') ||
		path.startsWith('/_')
	) {
		return resolve(event);
	}

	// All other requests are forwarded to the provider
	return handleProxyRequest(event.request);
};
