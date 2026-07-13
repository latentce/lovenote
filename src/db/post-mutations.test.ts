import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import type { Database } from './client';
import { createPost, setOwnPostStatus, type PostLifecycleResult } from './post-mutations';

function databaseReturning(rows: { id: number }[]) {
	const execute = vi.fn().mockResolvedValue({ rows });
	return { database: { execute } as unknown as Database, execute };
}

describe('post creation mutation', () => {
	it('returns the created post ID', async () => {
		const { database, execute } = databaseReturning([{ id: 42 }]);

		await expect(
			createPost(database, 'author-id', {
				body: 'A post',
				visibility: 'private',
				attachmentIds: [],
			}),
		).resolves.toBe(42);
		expect(execute).toHaveBeenCalledOnce();
	});

	it('returns null when any requested attachment is unavailable', async () => {
		const { database, execute } = databaseReturning([]);
		const attachmentId = '3df91f2d-582c-4d2a-b24d-c42d2ed58f7d';

		await expect(
			createPost(database, 'author-id', {
				body: '',
				visibility: 'public',
				attachmentIds: [attachmentId],
			}),
		).resolves.toBeNull();

		const query = execute.mock.calls[0]?.[0];
		const compiledQuery = new PgDialect().sqlToQuery(query!);
		expect(compiledQuery.sql).toContain('from unnest(array[');
		expect(compiledQuery.sql).toContain('for update of media_assets');
		expect(compiledQuery.params).toContain(attachmentId);
	});

	it('parameterizes author-controlled post values', async () => {
		const { database, execute } = databaseReturning([{ id: 7 }]);
		const body = "Robert'); delete from posts; --";

		await createPost(database, 'author-id', {
			body,
			visibility: 'public',
			attachmentIds: [],
		});

		const query = execute.mock.calls[0]?.[0];
		const compiledQuery = new PgDialect().sqlToQuery(query!);
		expect(compiledQuery.sql).not.toContain(body);
		expect(compiledQuery.params).toContain('author-id');
		expect(compiledQuery.params).toContain(body);
	});
});

describe('post lifecycle mutations', () => {
	function lifecycleDatabase(rows: PostLifecycleResult[]) {
		const execute = vi.fn().mockResolvedValue({ rows });
		return { database: { execute } as unknown as Database, execute };
	}

	it('atomically hides only an owned active post and rotates its media URLs', async () => {
		const expected: PostLifecycleResult = {
			changed: true,
			id: 42,
			media: [{ id: '3df91f2d-582c-4d2a-b24d-c42d2ed58f7d', previousRevision: 1 }],
			tagIds: [3, 7],
			visibility: 'public',
		};
		const { database, execute } = lifecycleDatabase([expected]);

		await expect(setOwnPostStatus(database, 'author-id', 42, 'hidden')).resolves.toEqual(expected);

		const query = execute.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query!);
		expect(compiled.sql).toContain('posts.author_id = $');
		expect(compiled.sql).toContain('for update of posts');
		expect(compiled.sql).toContain('delivery_revision = media_assets.delivery_revision + 1');
		expect(compiled.sql).toContain('media_to_purge');
		expect(compiled.sql).toContain('as "tagIds"');
		expect(compiled.params).toContain('author-id');
		expect(compiled.params).toContain(42);
		expect(compiled.params).toContain('hidden');
	});

	it('restores an owned hidden post without rotating media URLs', async () => {
		const expected: PostLifecycleResult = {
			changed: true,
			id: 42,
			media: [],
			tagIds: [],
			visibility: 'private',
		};
		const { database, execute } = lifecycleDatabase([expected]);

		await expect(setOwnPostStatus(database, 'author-id', 42, 'active')).resolves.toEqual(expected);

		const query = execute.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query!);
		expect(compiled.params).toContain('active');
		expect(compiled.params).toContain('hidden');
	});

	it('is retryable for an already hidden post and rejects unavailable targets', async () => {
		const alreadyHidden: PostLifecycleResult = {
			changed: false,
			id: 42,
			media: [{ id: '3df91f2d-582c-4d2a-b24d-c42d2ed58f7d', previousRevision: 1 }],
			tagIds: [],
			visibility: 'public',
		};
		const retry = lifecycleDatabase([alreadyHidden]);
		const unavailable = lifecycleDatabase([]);

		await expect(setOwnPostStatus(retry.database, 'author-id', 42, 'hidden')).resolves.toEqual(alreadyHidden);
		await expect(setOwnPostStatus(unavailable.database, 'author-id', 42, 'hidden')).resolves.toBeNull();
	});
});
