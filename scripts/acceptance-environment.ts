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

type AcceptanceEnvironment = Record<string, string | undefined>;

export function verifyAcceptanceEnvironment(environment: AcceptanceEnvironment) {
	const missing = required.filter((name) => !environment[name]?.trim());
	if (missing.length > 0) {
		throw new Error(`Full acceptance requires: ${missing.join(', ')}.`);
	}

	if (environment.E2E_DATABASE_ISOLATED !== '1') {
		throw new Error(
			'Full acceptance requires E2E_DATABASE_ISOLATED=1 to attest that DATABASE_URL uses a disposable database or branch.',
		);
	}

	if (environment.E2E_MUTATIONS !== '1' || environment.E2E_UPLOADS !== '1') {
		throw new Error('Full acceptance requires E2E_MUTATIONS=1 and E2E_UPLOADS=1. Use test:acceptance:smoke for non-mutating coverage.');
	}

	if (environment.R2_BUCKET_NAME !== 'lovenote-media-test') {
		throw new Error('Full acceptance must use the lovenote-media-test R2 bucket.');
	}
}
