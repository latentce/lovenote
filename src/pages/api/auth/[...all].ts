import type { APIRoute } from 'astro';

export const ALL: APIRoute = async ({ locals, request }) => {
	const response = await locals.auth.handler(request);

	response.headers.set('Cache-Control', 'private, no-store');
	response.headers.set('Pragma', 'no-cache');

	return response;
};
