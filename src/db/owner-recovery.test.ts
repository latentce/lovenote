import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from './client';
import { recoverOwnerPassword } from './owner-recovery';

describe('owner recovery', () => {
	it('updates the sole owner credential and revokes sessions in one parameterized statement', async () => {
		const execute = vi.fn().mockResolvedValue({
			rows: [{ sessionsRevoked: 3, userId: 'owner-id' }],
		});
		const database = { execute } as unknown as Database;
		const passwordHash = 'secret-password-hash';

		await expect(recoverOwnerPassword(database, passwordHash)).resolves.toEqual({
			sessionsRevoked: 3,
			userId: 'owner-id',
		});

		const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
		expect(query.sql).toContain("'admin' = any(string_to_array");
		expect(query.sql).toContain('having count(*) = 1');
		expect(query.sql).toContain("account.provider_id = 'credential'");
		expect(query.sql).toContain('delete from session');
		expect(query.params).toEqual([passwordHash]);
		expect(query.sql).not.toContain(passwordHash);
	});

	it('returns null when there is not exactly one recoverable owner', async () => {
		const database = {
			execute: vi.fn().mockResolvedValue({ rows: [] }),
		} as unknown as Database;

		await expect(recoverOwnerPassword(database, 'hash')).resolves.toBeNull();
	});
});
