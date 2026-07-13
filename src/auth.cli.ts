import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import type { Database } from './db/client';
import { createAuth } from './lib/auth';

const placeholderDatabaseUrl = 'postgresql://user:password@localhost:5432/lovenote';

export const auth = createAuth({
	baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:4321',
	database: drizzle(
		neon(process.env.DATABASE_URL ?? placeholderDatabaseUrl),
	) as unknown as Database,
	secret: process.env.BETTER_AUTH_SECRET ?? 'development-cli-secret-at-least-32-characters',
});
