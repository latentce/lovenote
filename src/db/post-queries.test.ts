import { drizzle } from 'drizzle-orm/neon-http';
import { describe, expect, it } from 'vitest';

import { buildPublicPostsQuery } from './post-queries';
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
