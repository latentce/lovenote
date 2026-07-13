import { describe, expect, it } from 'vitest';

import { changePasswordInputSchema, passwordValueSchema } from './password';

const validInput = {
	currentPassword: 'current-password',
	newPassword: 'a-new-secure-password',
	confirmPassword: 'a-new-secure-password',
};

describe('change password input', () => {
	it('shares the password limits used by recovery and account changes', () => {
		expect(passwordValueSchema.safeParse('a'.repeat(12)).success).toBe(true);
		expect(passwordValueSchema.safeParse('a'.repeat(11)).success).toBe(false);
		expect(passwordValueSchema.safeParse('a'.repeat(129)).success).toBe(false);
	});

	it('accepts a new password within the configured limits', () => {
		expect(changePasswordInputSchema.parse(validInput)).toEqual(validInput);
	});

	it('requires the password confirmation to match', () => {
		const result = changePasswordInputSchema.safeParse({
			...validInput,
			confirmPassword: 'another-secure-password',
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some(({ path }) => path[0] === 'confirmPassword')).toBe(true);
		}
	});

	it('requires a different password', () => {
		const result = changePasswordInputSchema.safeParse({
			...validInput,
			newPassword: validInput.currentPassword,
			confirmPassword: validInput.currentPassword,
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some(({ path }) => path[0] === 'newPassword')).toBe(true);
		}
	});

	it('enforces the server password limits', () => {
		expect(
			changePasswordInputSchema.safeParse({
				...validInput,
				newPassword: 'too-short',
				confirmPassword: 'too-short',
			}).success,
		).toBe(false);
		expect(
			changePasswordInputSchema.safeParse({
				...validInput,
				newPassword: 'a'.repeat(129),
				confirmPassword: 'a'.repeat(129),
			}).success,
		).toBe(false);
	});
});
