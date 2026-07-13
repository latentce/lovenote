import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../db/client';
import { createOwner, setupInputSchema } from './setup';

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

describe('owner creation', () => {
	it('populates Better Auth account fields that have no database default', async () => {
		const execute = vi.fn().mockResolvedValue({ rows: [{ userId: 'owner-id' }] });
		const database = { execute } as unknown as Database;

		await expect(
			createOwner(database, { password: 'a-secure-password', username: 'Owner.Name' }),
		).resolves.toBe('owner-id');

		const query = execute.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query!);
		expect(compiled.sql).toContain(
			'insert into account (id, account_id, provider_id, user_id, password, updated_at)',
		);
		expect(compiled.sql).toMatch(
			/select \$\d+, id, 'credential', id, \$\d+, now\(\)/u,
		);
	});
});
