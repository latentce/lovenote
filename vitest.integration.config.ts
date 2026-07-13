import { defineConfig } from 'vitest/config';

const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL?.trim();

if (!integrationDatabaseUrl) {
	throw new Error(
		'INTEGRATION_DATABASE_URL is required and must point to an empty, disposable Neon branch.',
	);
}

if (integrationDatabaseUrl === process.env.DATABASE_URL?.trim()) {
	throw new Error('INTEGRATION_DATABASE_URL must not match DATABASE_URL.');
}

const protocol = new URL(integrationDatabaseUrl).protocol;
if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
	throw new Error('INTEGRATION_DATABASE_URL must be a Postgres connection string.');
}

export default defineConfig({
	test: {
		fileParallelism: false,
		hookTimeout: 30_000,
		include: ['tests/integration/**/*.test.ts'],
		testTimeout: 30_000,
	},
});
