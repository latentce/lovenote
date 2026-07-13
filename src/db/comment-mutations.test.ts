import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from './client';
import { createComment } from './comment-mutations';

function databaseReturning(rows: { id: number }[]) {
	const execute = vi.fn().mockResolvedValue({ rows });
	return { database: { execute } as unknown as Database, execute };
}

describe('comment creation mutation', () => {
	it('atomically inserts a comment only when a member can still view the post', async () => {
		const { database, execute } = databaseReturning([{ id: 9 }]);

		await expect(
			createComment(database, 'member-id', { body: 'Hello', postId: 42 }, false),
		).resolves.toBe(9);

		const query = execute.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query!);
		expect(compiled.sql).toContain("posts.status = 'active'");
		expect(compiled.sql).toContain("posts.status = 'hidden'");
		expect(compiled.sql).toContain('posts.author_id = $');
		expect(compiled.params).toContain('member-id');
		expect(compiled.params).toContain(42);
	});

	it('allows the owner to target any post not awaiting deletion', async () => {
		const { database, execute } = databaseReturning([{ id: 10 }]);

		await createComment(database, 'owner-id', { body: 'Owner comment', postId: 42 }, true);

		const query = execute.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query!);
		expect(compiled.sql).toContain("posts.status <> 'deleting'");
		expect(compiled.sql).not.toContain("posts.status = 'hidden'");
	});

	it('returns null when the post is no longer visible and parameterizes comment text', async () => {
		const { database, execute } = databaseReturning([]);
		const body = "Nice'); delete from comments; --";

		await expect(createComment(database, 'member-id', { body, postId: 42 }, false)).resolves.toBeNull();

		const query = execute.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query!);
		expect(compiled.sql).not.toContain(body);
		expect(compiled.params).toContain(body);
	});
});
