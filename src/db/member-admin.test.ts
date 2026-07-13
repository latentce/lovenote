import { drizzle } from 'drizzle-orm/neon-http';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { MAX_MEMBER_ACCOUNTS } from '../lib/member';
import type { Database } from './client';
import { schema } from './client';
import {
	addMemberPermissions,
	buildMemberListQuery,
	updateMemberPermissions,
} from './member-admin';

const permissions = {
	createComments: true,
	createPosts: true,
	deleteOwnPosts: true,
	editOwnPosts: true,
	favoritePosts: true,
	hideOwnPosts: true,
	manageTags: false,
	moderateComments: false,
	uploadImages: true,
	uploadVideos: true,
};

describe('owner member queries', () => {
	it('lists auth users with application permissions without credentials or internal email', () => {
		const database = drizzle.mock({ schema });
		const query = buildMemberListQuery(database).toSQL();

		expect(query.sql).toContain('left join "member_permissions"');
		expect(query.sql).toContain('order by "user"."created_at" asc');
		expect(query.sql).not.toContain('"user"."email"');
		expect(query.sql).not.toContain('from "account"');
		expect(query.sql).not.toContain('"account"."password"');
	});

	it('adds a temporary-password capability record only within the account limit', async () => {
		const execute = vi.fn().mockResolvedValue({ rows: [{ userId: 'member-id' }] });
		const database = { execute } as unknown as Database;

		await expect(addMemberPermissions(database, 'member-id', permissions)).resolves.toBe('member-id');

		const query = execute.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query!);
		expect(compiled.sql).toContain('row_number() over');
		expect(compiled.sql).toContain('insert into member_permissions');
		expect(compiled.sql).toContain('on conflict (user_id) do nothing');
		expect(compiled.params).toContain('member-id');
		expect(compiled.params).toContain(MAX_MEMBER_ACCOUNTS);
		expect(compiled.params).toContain(true);
		expect(compiled.params).toContain(false);
	});

	it('returns null when the account is outside the limit or already initialized', async () => {
		const database = {
			execute: vi.fn().mockResolvedValue({ rows: [] }),
		} as unknown as Database;

		await expect(addMemberPermissions(database, 'extra-member', permissions)).resolves.toBeNull();
	});

	it('atomically replaces a member’s capabilities while excluding the owner role', async () => {
		const execute = vi.fn().mockResolvedValue({ rows: [{ userId: 'member-id' }] });
		const database = { execute } as unknown as Database;

		await expect(
			updateMemberPermissions(database, { ...permissions, manageTags: true, userId: 'member-id' }),
		).resolves.toBe('member-id');

		const query = execute.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query!);
		expect(compiled.sql).toContain('update member_permissions');
		expect(compiled.sql).toContain('from "user"');
		expect(compiled.sql).toContain("'admin' = any(string_to_array");
		expect(compiled.sql).toContain('updated_at = now()');
		expect(compiled.params).toContain('member-id');
		expect(compiled.params).toContain(true);
		expect(compiled.params).toContain(false);
	});

	it('returns null for an owner or missing capability record', async () => {
		const database = {
			execute: vi.fn().mockResolvedValue({ rows: [] }),
		} as unknown as Database;

		await expect(
			updateMemberPermissions(database, { ...permissions, userId: 'owner-id' }),
		).resolves.toBeNull();
	});
});
