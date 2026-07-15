import { existsSync } from 'node:fs';

import { defineConfig } from 'drizzle-kit';

if (existsSync('.dev.vars')) process.loadEnvFile('.dev.vars');

export default defineConfig({
	schema: ['./src/db/auth-schema.ts', './src/db/schema.ts'],
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? '',
	},
	strict: true,
	verbose: true,
});
