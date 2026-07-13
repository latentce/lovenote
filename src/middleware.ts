import { eq } from 'drizzle-orm';
import { defineMiddleware } from 'astro:middleware';

import { memberPermissions } from './db/schema';
import { isActiveMember } from './lib/authorization';
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
		const sessionResult = await auth.api.getSession({
			headers: context.request.headers,
		});

		if (sessionResult && isActiveMember(sessionResult.user)) {
			const permissions = await database.query.memberPermissions.findFirst({
				where: eq(memberPermissions.userId, sessionResult.user.id),
			});

			context.locals.permissions = permissions ?? null;
			context.locals.session = sessionResult.session;
			context.locals.user = sessionResult.user;
		}
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
