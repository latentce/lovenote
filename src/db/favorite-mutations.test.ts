import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from './client';
import { isPostFavorited, toggleFavorite, type FavoriteToggleResult } from './favorite-mutations';

function databaseReturning<T>(rows: T[]) {
	const execute = vi.fn().mockResolvedValue({ rows });
	return { database: { execute } as unknown as Database, execute };
}

describe('favorite mutations', () => {
	it('atomically toggles a favorite only while a member can view the post', async () => {
		const expected = { changed: true, favorited: true, visible: true };
		const { database, execute } = databaseReturning<FavoriteToggleResult>([expected]);

		await expect(toggleFavorite(database, 'member-id', 42, false)).resolves.toEqual(expected);

		const query = execute.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query!);
		expect(compiled.sql).toContain("posts.status = 'active'");
		expect(compiled.sql).toContain("posts.status = 'hidden'");
		expect(compiled.sql).toContain('delete from favorites');
		expect(compiled.sql).toContain('insert into favorites');
		expect(compiled.sql).toContain('on conflict (user_id, post_id) do nothing');
		expect(compiled.params).toContain('member-id');
		expect(compiled.params).toContain(42);
	});

	it('lets the owner target any post not awaiting deletion', async () => {
		const { database, execute } = databaseReturning<FavoriteToggleResult>([
			{ changed: true, favorited: false, visible: true },
		]);

		await toggleFavorite(database, 'owner-id', 42, true);

		const query = execute.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query!);
		expect(compiled.sql).toContain("posts.status <> 'deleting'");
		expect(compiled.sql).not.toContain("posts.status = 'hidden'");
	});

	it('returns a safe unavailable result when the post cannot be targeted', async () => {
		const { database } = databaseReturning<FavoriteToggleResult>([]);

		await expect(toggleFavorite(database, 'member-id', 42, false)).resolves.toEqual({
			changed: false,
			favorited: false,
			visible: false,
		});
	});

	it('looks up only the current user and post favorite pair', async () => {
		const { database, execute } = databaseReturning([{ favorited: true }]);

		await expect(isPostFavorited(database, 'member-id', 42)).resolves.toBe(true);

		const query = execute.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query!);
		expect(compiled.params).toEqual(['member-id', 42]);
	});
});
