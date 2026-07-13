import { drizzle } from 'drizzle-orm/neon-http';
import { describe, expect, it } from 'vitest';

import type { AuthenticatedUser } from '../lib/auth';
import { schema } from './client';
import { buildModeratableCommentsQuery, COMMENT_MODERATION_LIMIT } from './comment-moderation-queries';

describe('comment moderation query', () => {
	it('shows a moderator comments on active posts and only their own hidden posts', () => {
		const database = drizzle.mock({ schema });
		const viewer = {
			banned: false,
			id: 'moderator-id',
			role: 'user',
		} as AuthenticatedUser;
		const query = buildModeratableCommentsQuery(database, viewer).toSQL();

		expect(query.sql).toContain('inner join "posts"');
		expect(query.sql).toContain('inner join "user"');
		expect(query.sql).toContain('"posts"."author_id" = $');
		expect(query.sql).not.toContain('object_key');
		expect(query.params).toContain('active');
		expect(query.params).toContain('hidden');
		expect(query.params).toContain('moderator-id');
		expect(query.params).toContain(COMMENT_MODERATION_LIMIT);
	});

	it('shows the owner comments on all posts except those awaiting deletion', () => {
		const database = drizzle.mock({ schema });
		const viewer = {
			banned: false,
			id: 'owner-id',
			role: 'admin',
		} as AuthenticatedUser;
		const query = buildModeratableCommentsQuery(database, viewer).toSQL();

		expect(query.sql).toContain('"posts"."status" <> $');
		expect(query.params).toContain('deleting');
		expect(query.params).not.toContain('hidden');
	});
});
