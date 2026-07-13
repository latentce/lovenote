import { describe, expect, it } from 'vitest';

import { setupInputSchema } from './setup';

const validInput = {
	setupSecret: 'local-setup-secret',
	username: 'Owner.Name',
	password: 'a-secure-password',
	confirmPassword: 'a-secure-password',
};

describe('setup input', () => {
	it('accepts a Better Auth-compatible username and strong password', () => {
		expect(setupInputSchema.parse(validInput)).toEqual(validInput);
	});

	it.each(['ab', 'owner name', 'owner-name', 'owner@example'])('rejects username %s', (username) => {
		expect(setupInputSchema.safeParse({ ...validInput, username }).success).toBe(false);
	});

	it('requires matching passwords', () => {
		const result = setupInputSchema.safeParse({
			...validInput,
			confirmPassword: 'a-different-password',
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.path).toEqual(['confirmPassword']);
		}
	});

	it('enforces the configured password limits', () => {
		expect(
			setupInputSchema.safeParse({
				...validInput,
				password: 'too-short',
				confirmPassword: 'too-short',
			}).success,
		).toBe(false);
		expect(
			setupInputSchema.safeParse({
				...validInput,
				password: 'a'.repeat(129),
				confirmPassword: 'a'.repeat(129),
			}).success,
		).toBe(false);
	});
});
