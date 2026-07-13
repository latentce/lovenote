import { defineConfig } from 'drizzle-kit';

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
