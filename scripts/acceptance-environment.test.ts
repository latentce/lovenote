import { describe, expect, it } from 'vitest';

import { verifyAcceptanceEnvironment } from './acceptance-environment';

function validEnvironment() {
	return {
		BETTER_AUTH_SECRET: 'auth-secret',
		DATABASE_URL: 'postgresql://user:password@host/lovenote_test',
		E2E_DATABASE_ISOLATED: '1',
		E2E_MEMBER_PASSWORD: 'member-password',
		E2E_MEMBER_USERNAME: 'member',
		E2E_MUTATIONS: '1',
		E2E_OWNER_PASSWORD: 'owner-password',
		E2E_OWNER_USERNAME: 'owner',
		E2E_UPLOADS: '1',
		R2_ACCESS_KEY_ID: 'access-key',
		R2_ACCOUNT_ID: 'account-id',
		R2_BUCKET_NAME: 'lovenote-media-test',
		R2_SECRET_ACCESS_KEY: 'secret-key',
		SETUP_SECRET: 'setup-secret',
	};
}

describe('full acceptance environment', () => {
	it('accepts explicitly isolated destructive resources', () => {
		expect(() => verifyAcceptanceEnvironment(validEnvironment())).not.toThrow();
	});

	it.each([undefined, '', '0', 'true'])(
		'rejects database isolation marker %s',
		(marker) => {
			expect(() => verifyAcceptanceEnvironment({
				...validEnvironment(),
				E2E_DATABASE_ISOLATED: marker,
			})).toThrow(/E2E_DATABASE_ISOLATED=1/u);
		},
	);

	it('still rejects the production R2 bucket', () => {
		expect(() => verifyAcceptanceEnvironment({
			...validEnvironment(),
			R2_BUCKET_NAME: 'lovenote-media',
		})).toThrow(/lovenote-media-test/u);
	});
});
