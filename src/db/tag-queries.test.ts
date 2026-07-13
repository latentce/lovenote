import { drizzle } from 'drizzle-orm/neon-http';
import { describe, expect, it } from 'vitest';

import {
	buildAssignableTagsQuery,
	buildPublicTagPostsQuery,
	buildPublicTagsQuery,
} from './tag-queries';
import { schema } from './client';

describe('public tag queries', () => {
	it('lists all tag labels for protected post forms without post metadata', () => {
		const database = drizzle.mock({ schema });
		const query = buildAssignableTagsQuery(database).toSQL();

		expect(query.sql).toContain('from "tags"');
		expect(query.sql).toContain('order by "tags"."display_name" asc');
		expect(query.sql).not.toContain('post_tags');
	});

	it('lists only tags joined to active public posts with public counts', () => {
		const database = drizzle.mock({ schema });
		const query = buildPublicTagsQuery(database).toSQL();

		expect(query.sql).toContain('count(distinct "posts"."id")::integer');
		expect(query.sql).toContain('inner join "post_tags"');
		expect(query.sql).toContain('inner join "posts"');
		expect(query.params).toContain('active');
		expect(query.params).toContain('public');
	});

	it('finds a tag by its exact slug without exposing private-only metadata', () => {
		const database = drizzle.mock({ schema });
		const query = buildPublicTagsQuery(database, 'family').toSQL();

		expect(query.sql).toContain('"tags"."slug" = $');
		expect(query.params).toContain('family');
		expect(query.params).toContain(1);
	});

	it('isolates a tag archive to active public posts and ready ordered media', () => {
		const database = drizzle.mock({ schema });
		const cursor = { createdAt: new Date('2026-07-13T18:00:00.000Z'), id: 42 };
		const query = buildPublicTagPostsQuery(database, 7, cursor, 20).toSQL();

		expect(query.sql).toContain('in (select "post_id" from "post_tags"');
		expect(query.sql).toContain('"posts_media"."upload_state"');
		expect(query.sql).not.toContain('object_key');
		expect(query.sql.toLowerCase()).not.toContain(' offset ');
		expect(query.params).toContain('active');
		expect(query.params).toContain('public');
		expect(query.params).toContain('ready');
		expect(query.params).toContain(7);
		expect(query.params).toContain(42);
		expect(query.params).toContain(21);
	});
});
