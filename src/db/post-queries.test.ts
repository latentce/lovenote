import { drizzle } from 'drizzle-orm/neon-http';
import { describe, expect, it } from 'vitest';

import type { AuthenticatedUser } from '../lib/auth';
import { buildPostDetailQuery, buildPublicPostsQuery } from './post-queries';
import { schema } from './client';

describe('public post feed query', () => {
	it('isolates active public posts and ready ordered attachments in one cursor query', () => {
		const database = drizzle.mock({ schema });
		const cursor = { createdAt: new Date('2026-07-13T18:00:00.000Z'), id: 42 };
		const query = buildPublicPostsQuery(database, cursor, 20).toSQL();

		expect(query.sql).toContain('"posts"."status" = $');
		expect(query.sql).toContain('"posts"."visibility" = $');
		expect(query.sql).toContain('"posts_media"."upload_state"');
		expect(query.sql).toContain('"posts_media"."attachment_order" asc');
		expect(query.sql.toLowerCase()).not.toContain(' offset ');
		expect(query.params).toContain('active');
		expect(query.params).toContain('public');
		expect(query.params).toContain('ready');
		expect(query.params).toContain(42);
		expect(query.params).toContain(21);
	});
});

describe('post detail query', () => {
	it('isolates anonymous detail reads to active public posts and public-safe relations', () => {
		const database = drizzle.mock({ schema });
		const query = buildPostDetailQuery(database, 42, null).toSQL();

		expect(query.sql).toContain('count(*)::integer');
		expect(query.sql).toContain('"posts_comments"."status"');
		expect(query.sql).toContain('"posts_media"."upload_state"');
		expect(query.sql).not.toContain('object_key');
		expect(query.params).toContain(42);
		expect(query.params).toContain('active');
		expect(query.params).toContain('public');
		expect(query.params).toContain('visible');
		expect(query.params).toContain('ready');
	});

	it('lets active members read private posts and only their own hidden posts', () => {
		const database = drizzle.mock({ schema });
		const query = buildPostDetailQuery(database, 42, {
			banned: false,
			id: 'member-id',
			role: 'user',
		} as AuthenticatedUser).toSQL();

		expect(query.params).toContain('active');
		expect(query.params).toContain('hidden');
		expect(query.params).toContain('member-id');
		expect(query.params).not.toContain('public');
	});

	it('lets the owner read every post except records awaiting deletion', () => {
		const database = drizzle.mock({ schema });
		const query = buildPostDetailQuery(database, 42, {
			banned: false,
			id: 'owner-id',
			role: 'admin',
		} as AuthenticatedUser).toSQL();

		expect(query.sql).toContain('"posts"."status" <> $');
		expect(query.params).toContain('deleting');
		expect(query.params).not.toContain('public');
	});
});
