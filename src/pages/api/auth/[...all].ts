import type { APIRoute } from 'astro';

export const ALL: APIRoute = async ({ locals, request }) => {
	const response = await locals.auth.handler(request);

	response.headers.set('Cache-Control', 'private, no-store');
	response.headers.set('Pragma', 'no-cache');

	if (request.method !== 'GET') {
		const operation = new URL(request.url).pathname.replace('/api/auth/', '').replaceAll('/', '.');
		const message = JSON.stringify({
			event: 'auth.request',
			operation,
			status: response.status,
			succeeded: response.ok,
		});
		if (response.ok) console.info(message);
		else console.warn(message);
	}

	return response;
};
