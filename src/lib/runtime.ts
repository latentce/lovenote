import { env } from 'cloudflare:workers';

import { createDatabase } from '../db/client';
import { createAuth } from './auth';

export function createRequestRuntime(cfContext: ExecutionContext) {
	const database = createDatabase(env.DATABASE_URL);
	const auth = createAuth({
		baseURL: env.SITE_URL,
		database,
		runInBackground: (promise) => cfContext.waitUntil(promise),
		secret: env.BETTER_AUTH_SECRET,
	});

	return { auth, database };
}
