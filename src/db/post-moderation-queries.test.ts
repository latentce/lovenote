import { drizzle } from 'drizzle-orm/neon-http';
import { describe, expect, it } from 'vitest';

import { schema } from './client';
import { buildModeratablePostsQuery, MODERATABLE_POST_LIMIT } from './post-moderation-queries';

describe('post moderation queries', () => {
	it('lists the newest posts across every status without selecting private media keys', () => {
		const database = drizzle.mock({ schema });
		const query = buildModeratablePostsQuery(database).toSQL();

		expect(query.sql).toContain('inner join "user"');
		expect(query.sql).toContain('count(*)::integer');
		expect(query.sql).toContain('order by "posts"."created_at" desc, "posts"."id" desc');
		expect(query.sql).not.toContain('"posts"."status" =');
		expect(query.sql).not.toContain('"media_assets"."object_key"');
		expect(query.params).toContain(MODERATABLE_POST_LIMIT);
	});
});
