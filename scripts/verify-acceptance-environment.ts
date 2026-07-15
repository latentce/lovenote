import { existsSync } from 'node:fs';

if (existsSync('.dev.vars')) process.loadEnvFile('.dev.vars');

const required = [
	'BETTER_AUTH_SECRET',
	'DATABASE_URL',
	'E2E_MEMBER_PASSWORD',
	'E2E_MEMBER_USERNAME',
	'E2E_OWNER_PASSWORD',
	'E2E_OWNER_USERNAME',
	'R2_ACCESS_KEY_ID',
	'R2_ACCOUNT_ID',
	'R2_BUCKET_NAME',
	'R2_SECRET_ACCESS_KEY',
	'SETUP_SECRET',
] as const;

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
	throw new Error(`Full acceptance requires: ${missing.join(', ')}.`);
}

if (process.env.E2E_MUTATIONS !== '1' || process.env.E2E_UPLOADS !== '1') {
	throw new Error('Full acceptance requires E2E_MUTATIONS=1 and E2E_UPLOADS=1. Use test:acceptance:smoke for non-mutating coverage.');
}

if (process.env.R2_BUCKET_NAME !== 'lovenote-media-test') {
	throw new Error('Full acceptance must use the lovenote-media-test R2 bucket.');
}

console.info('Full acceptance environment is configured.');
