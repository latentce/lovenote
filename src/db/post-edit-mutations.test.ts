import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from './client';
import { updateOwnPost, type PostEditResult } from './post-edit-mutations';

function databaseReturning(rows: PostEditResult[]) {
	const execute = vi.fn().mockResolvedValue({ rows });
	return { database: { execute } as unknown as Database, execute };
}

describe('post edit mutation', () => {
	it('atomically updates only an owned non-deleting post and preserves valid media-only posts', async () => {
		const expected: PostEditResult = {
			changed: true,
			id: 42,
			media: [],
			previousVisibility: 'private',
			status: 'active',
			tagIds: [],
			visibility: 'private',
		};
		const { database, execute } = databaseReturning([expected]);

		await expect(updateOwnPost(database, 'author-id', { body: '', postId: 42, tagIds: [], visibility: 'private' })).resolves.toEqual(expected);

		const query = execute.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query!);
		expect(compiled.sql).toContain('posts.author_id = $');
		expect(compiled.sql).toContain("posts.status <> 'deleting'");
		expect(compiled.sql).toContain("media_assets.upload_state = 'ready'");
		expect(compiled.sql).toContain('regexp_replace');
		expect(compiled.sql).toContain('attachment_count.value > 0');
		expect(compiled.sql).toContain('as "previousVisibility"');
		expect(compiled.sql).toContain('as "tagIds"');
		expect(compiled.sql).toContain('delete from post_tags');
		expect(compiled.sql).toContain('insert into post_tags');
		expect(compiled.params).toContain('author-id');
		expect(compiled.params).toContain(42);
	});

	it('rotates media URLs when reducing a public post to private and supports purge retries', async () => {
		const expected: PostEditResult = {
			changed: true,
			id: 42,
			media: [{ id: '3df91f2d-582c-4d2a-b24d-c42d2ed58f7d', previousRevision: 2 }],
			previousVisibility: 'public',
			status: 'active',
			tagIds: [7],
			visibility: 'private',
		};
		const { database, execute } = databaseReturning([expected]);

		await updateOwnPost(database, 'author-id', { body: 'Private now', postId: 42, tagIds: [7], visibility: 'private' });

		const query = execute.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query!);
		expect(compiled.sql).toContain('delivery_revision = media_assets.delivery_revision + 1');
		expect(compiled.sql).toContain('retry_media');
		expect(compiled.params).toContain('private');
	});

	it('returns null when ownership, status, or the text-or-media rule fails', async () => {
		const { database } = databaseReturning([]);

		await expect(updateOwnPost(database, 'other-user', { body: '', postId: 42, tagIds: [], visibility: 'public' })).resolves.toBeNull();
	});
});
