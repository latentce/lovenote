import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from './client';
import { canModeratePost, deleteComment, setCommentStatus } from './comment-moderation';

function databaseReturning<T>(rows: T[]) {
	const execute = vi.fn().mockResolvedValue({ rows });
	return { database: { execute } as unknown as Database, execute };
}

function compiledCall(execute: ReturnType<typeof vi.fn>) {
	const query = execute.mock.calls[0]?.[0];
	return new PgDialect().sqlToQuery(query!);
}

describe('comment moderation mutations', () => {
	it('atomically hides a comment only when a member can view its post', async () => {
		const row = { changed: true, id: 9, postId: 42 };
		const { database, execute } = databaseReturning([row]);

		await expect(setCommentStatus(database, 'moderator-id', 9, 'hidden', false)).resolves.toEqual(row);

		const query = compiledCall(execute);
		expect(query.sql).toContain('for update of comments');
		expect(query.sql).toContain("posts.status = 'active'");
		expect(query.sql).toContain("posts.status = 'hidden'");
		expect(query.sql).toContain('posts.author_id = $');
		expect(query.sql).toContain('target_comment.status <> $');
		expect(query.params).toContain('moderator-id');
		expect(query.params).toContain(9);
		expect(query.params).toContain('hidden');
	});

	it('lets the owner moderate comments on every non-deleting post', async () => {
		const { database, execute } = databaseReturning([{ changed: false, id: 9, postId: 42 }]);

		await setCommentStatus(database, 'owner-id', 9, 'visible', true);

		const query = compiledCall(execute);
		expect(query.sql).toContain("posts.status <> 'deleting'");
		expect(query.sql).not.toContain("posts.status = 'hidden'");
	});

	it('permanently deletes through the same visibility guard', async () => {
		const { database, execute } = databaseReturning([{ changed: true, id: 9, postId: 42 }]);

		await expect(deleteComment(database, 'moderator-id', 9, false)).resolves.toEqual({
			changed: true,
			id: 9,
			postId: 42,
		});

		const query = compiledCall(execute);
		expect(query.sql).toContain('delete from comments');
		expect(query.sql).toContain("posts.status = 'active'");
		expect(query.params).toContain('moderator-id');
		expect(query.params).toContain(9);
	});

	it('returns null when the comment is absent or no longer moderatable', async () => {
		const { database } = databaseReturning([]);

		await expect(setCommentStatus(database, 'moderator-id', 999, 'hidden', false)).resolves.toBeNull();
	});

	it('rechecks post visibility before retrying a cache purge', async () => {
		const { database, execute } = databaseReturning([{ id: 42 }]);

		await expect(canModeratePost(database, 'moderator-id', 42, false)).resolves.toBe(true);

		const query = compiledCall(execute);
		expect(query.sql).toContain("posts.status = 'active'");
		expect(query.sql).toContain('posts.author_id = $');
		expect(query.params).toContain('moderator-id');
		expect(query.params).toContain(42);
	});
});
