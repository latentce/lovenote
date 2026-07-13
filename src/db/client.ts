import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import * as appSchema from './schema';
import * as authSchema from './auth-schema';

export const schema = {
	...authSchema,
	...appSchema,
};

export function createDatabase(databaseUrl: string) {
	if (!databaseUrl) {
		throw new Error('DATABASE_URL is required');
	}

	return drizzle(neon(databaseUrl), { schema });
}

export type Database = ReturnType<typeof createDatabase>;
