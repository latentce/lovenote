import { describe, expect, it } from 'vitest';

import { verifyProductionConfig } from './production-config';

function validConfig() {
	const secrets = {
		required: [
			'DATABASE_URL',
			'BETTER_AUTH_SECRET',
			'SETUP_SECRET',
			'R2_ACCESS_KEY_ID',
			'R2_SECRET_ACCESS_KEY',
		],
	};
	return {
		compatibility_date: '2026-07-15',
		env: {
			acceptance: {
				r2_buckets: [
					{ binding: 'MEDIA_BUCKET', bucket_name: 'lovenote-media-test', remote: true },
				],
				secrets,
				vars: { R2_BUCKET_NAME: 'lovenote-media-test' },
			},
		},
		observability: { enabled: true },
		r2_buckets: [{ binding: 'MEDIA_BUCKET', bucket_name: 'lovenote-media' }],
		secrets,
		vars: {
			R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
			R2_BUCKET_NAME: 'lovenote-media',
			SITE_URL: 'https://lovenote.example.net',
		},
	};
}

describe('production configuration preflight', () => {
	it('accepts isolated production and acceptance resources', () => {
		expect(verifyProductionConfig(validConfig()).vars.SITE_URL).toBe('https://lovenote.example.net');
	});

	it.each([
		['example site', (config: ReturnType<typeof validConfig>) => (config.vars.SITE_URL = 'https://lovenote.example.com')],
		['invalid account', (config: ReturnType<typeof validConfig>) => (config.vars.R2_ACCOUNT_ID = 'replace-me')],
		['test production bucket', (config: ReturnType<typeof validConfig>) => (config.vars.R2_BUCKET_NAME = config.r2_buckets[0]!.bucket_name = 'lovenote-media-test')],
		['shared bucket', (config: ReturnType<typeof validConfig>) => (config.r2_buckets[0]!.bucket_name = config.vars.R2_BUCKET_NAME = 'lovenote-media-test')],
	])('rejects %s', (_name, mutate) => {
		const config = validConfig();
		mutate(config);
		expect(() => verifyProductionConfig(config)).toThrow();
	});

	it('rejects an incomplete secret declaration', () => {
		const config = validConfig();
		config.secrets.required.pop();
		expect(() => verifyProductionConfig(config)).toThrow(/missing required secrets/u);
	});
});
