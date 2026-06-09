import type { ServerLoad } from '@sveltejs/kit';

export const load: ServerLoad = async () => {
	return {
		providerUrl: process.env.PROXY_PROVIDER_URL,
	};
};
