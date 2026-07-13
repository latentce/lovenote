import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import type { Database } from './client';
import { createPost } from './post-mutations';

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
