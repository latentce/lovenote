import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from './client';
import {
	finalizePostDeletion,
	finalizeOwnPostDeletion,
	stagePostDeletion,
	stageOwnPostDeletion,
	type StagedPostDeletion,
} from './post-deletion-mutations';

function databaseReturning<T>(rows: T[]) {
	const execute = vi.fn().mockResolvedValue({ rows });
	return { database: { execute } as unknown as Database, execute };
}

describe('post deletion mutations', () => {
	it('atomically marks only an owned post deleting and rotates its media revisions', async () => {
		const expected: StagedPostDeletion = {
			changed: true,
			id: 42,
			media: [{
				id: '3df91f2d-582c-4d2a-b24d-c42d2ed58f7d',
				objectKey: 'private/object-key',
				previousRevision: 2,
			}],
			previousStatus: 'active',
			tagIds: [3, 7],
			visibility: 'public',
		};
		const { database, execute } = databaseReturning([expected]);

		await expect(stageOwnPostDeletion(database, 'author-id', 42)).resolves.toEqual(expected);

		const query = execute.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query!);
		expect(compiled.sql).toContain('posts.author_id = $');
		expect(compiled.sql).toContain('for update of posts');
		expect(compiled.sql).toContain("set status = 'deleting'");
		expect(compiled.sql).toContain('delivery_revision = media_assets.delivery_revision + 1');
		expect(compiled.sql).toContain('retry_media');
		expect(compiled.sql).toContain('as "previousStatus"');
		expect(compiled.sql).toContain('as "tagIds"');
		expect(compiled.params).toContain('author-id');
		expect(compiled.params).toContain(42);
	});

	it('returns retry metadata for an existing deleting record and rejects unavailable posts', async () => {
		const retry: StagedPostDeletion = {
			changed: false,
			id: 42,
			media: [],
			previousStatus: 'deleting',
			tagIds: [],
			visibility: 'private',
		};

		await expect(
			stageOwnPostDeletion(databaseReturning([retry]).database, 'author-id', 42),
		).resolves.toEqual(retry);
		await expect(
			stageOwnPostDeletion(databaseReturning([]).database, 'author-id', 42),
		).resolves.toBeNull();
	});

	it('lets an owner stage any post without weakening the member predicate', async () => {
		const expected: StagedPostDeletion = {
			changed: true,
			id: 42,
			media: [],
			previousStatus: 'hidden',
			tagIds: [],
			visibility: 'private',
		};
		const { database, execute } = databaseReturning([expected]);

		await expect(stagePostDeletion(database, 'owner-id', 42, true)).resolves.toEqual(expected);

		const query = execute.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query!);
		expect(compiled.sql).toContain('and true');
		expect(compiled.sql).not.toContain('posts.author_id =');
		expect(compiled.params).not.toContain('owner-id');
	});

	it('finalizes only an owned record already marked deleting', async () => {
		const { database, execute } = databaseReturning([{ id: 42 }]);

		await expect(finalizeOwnPostDeletion(database, 'author-id', 42)).resolves.toBe(42);

		const query = execute.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query!);
		expect(compiled.sql).toContain("posts.status = 'deleting'");
		expect(compiled.params).toEqual([42, 'author-id']);
	});

	it('lets an owner finalize any deleting post', async () => {
		const { database, execute } = databaseReturning([{ id: 42 }]);

		await expect(finalizePostDeletion(database, 'owner-id', 42, true)).resolves.toBe(42);

		const query = execute.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query!);
		expect(compiled.sql).toContain('and true');
		expect(compiled.sql).not.toContain('posts.author_id =');
		expect(compiled.params).toEqual([42]);
	});
});
