import { describe, expect, it } from 'vitest';

import type { Database } from '../db/client';
import { createAuth } from './auth';

const database = {} as Database;

function makeAuth(allowUserCreation = false) {
	return createAuth({
		allowUserCreation,
		baseURL: 'https://example.com',
		database,
		secret: 'test-secret-that-is-at-least-32-characters',
	});
}

describe('authentication configuration', () => {
	it('exposes username login without public email account flows', () => {
		const auth = makeAuth();

		expect(auth.options.emailAndPassword?.enabled).toBe(true);
		expect(auth.options.emailAndPassword?.disableSignUp).toBe(true);
		expect(auth.options.disabledPaths).toEqual(
			expect.arrayContaining([
				'/change-email',
				'/is-username-available',
				'/request-password-reset',
				'/reset-password',
				'/send-verification-email',
				'/sign-in/email',
				'/sign-up/email',
				'/verify-email',
			]),
		);
		expect(auth.options.plugins?.map((plugin) => plugin.id)).toContain('username');
	});

	it('allows user creation only for a server-only auth instance', () => {
		const auth = makeAuth(true);

		expect(auth.options.emailAndPassword?.disableSignUp).toBe(false);
		expect(auth.options.disabledPaths).not.toContain('/sign-up/email');
		expect(auth.options.disabledPaths).toContain('/sign-in/email');
	});
});
