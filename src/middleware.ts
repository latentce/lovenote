import { defineMiddleware } from 'astro:middleware';

import { loadRequestAuthorization } from './lib/request-authorization';
import { createRequestRuntime } from './lib/runtime';
import { applySecurityHeaders } from './lib/security-headers';

function safeErrorType(error: unknown) {
	return error instanceof Error ? error.name : typeof error;
}

export const onRequest = defineMiddleware(async (context, next) => {
	const { auth, database } = createRequestRuntime(context.locals.cfContext);

	context.locals.auth = auth;
	context.locals.database = database;
	context.locals.permissions = null;
	context.locals.session = null;
	context.locals.user = null;

	if (!context.url.pathname.startsWith('/api/auth/')) {
		const authorization = await loadRequestAuthorization(auth, database, context.request.headers);
		context.locals.permissions = authorization.permissions;
		context.locals.session = authorization.session;
		context.locals.user = authorization.user;
	}

	try {
		return applySecurityHeaders(await next());
	} catch (error) {
		console.error(
			JSON.stringify({
				event: 'request.unexpected_error',
				errorType: safeErrorType(error),
				method: context.request.method,
				path: context.url.pathname,
			}),
		);
		throw error;
	}
});
