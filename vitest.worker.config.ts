import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest({
			main: './tests/worker/fixture-worker.ts',
			wrangler: { configPath: './wrangler.jsonc' },
		}),
	],
	test: {
		include: ['tests/worker/**/*.test.ts'],
	},
});
