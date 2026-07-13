import { drizzle } from 'drizzle-orm/neon-http';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from './client';
import { schema } from './client';
import {
	buildManageableTagsQuery,
	createTag,
	findTagPurgeContext,
	mergeTags,
	updateTag,
} from './tag-admin';

function databaseReturning<T>(rows: T[]) {
	const execute = vi.fn().mockResolvedValue({ rows });
	return { database: { execute } as unknown as Database, execute };
}

describe('tag administration', () => {
	it('lists every tag with an all-post association count', () => {
		const database = drizzle.mock({ schema });
		const query = buildManageableTagsQuery(database).toSQL();

		expect(query.sql).toContain('left join "post_tags"');
		expect(query.sql).toContain('count("post_tags"."post_id")');
		expect(query.sql).toContain('group by "tags"."id"');
	});

	it('creates normalized metadata through parameterized SQL', async () => {
		const expected = { changed: true, publicPostIds: [], slug: 'good-news', tagId: 3 };
		const { database, execute } = databaseReturning([expected]);

		await expect(
			createTag(database, {
				description: 'A description',
				displayName: 'Good News',
				slug: 'good-news',
			}),
		).resolves.toEqual(expected);

		const compiled = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0]!);
		expect(compiled.sql).toContain('insert into tags');
		expect(compiled.params).toContain('good-news');
		expect(compiled.params).toContain('Good News');
	});

	it('updates metadata and returns affected public post IDs for purging', async () => {
		const expected = { changed: true, publicPostIds: [2, 8], slug: 'news', tagId: 3 };
		const { database, execute } = databaseReturning([expected]);

		await expect(
			updateTag(database, {
				description: '',
				displayName: 'News',
				slug: 'news',
				tagId: 3,
			}),
		).resolves.toEqual(expected);

		const compiled = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0]!);
		expect(compiled.sql).toContain('for update of tags');
		expect(compiled.sql).toContain("posts.status = 'active'");
		expect(compiled.sql).toContain('as "publicPostIds"');
	});

	it('atomically moves source links before deleting the source tag', async () => {
		const expected = {
			publicPostIds: [2, 8],
			sourceSlug: 'old',
			sourceTagId: 3,
			targetSlug: 'new',
			targetTagId: 4,
		};
		const { database, execute } = databaseReturning([expected]);

		await expect(mergeTags(database, { sourceTagId: 3, targetTagId: 4 })).resolves.toEqual(
			expected,
		);

		const compiled = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0]!);
		expect(compiled.sql).toContain('insert into post_tags');
		expect(compiled.sql).toContain('on conflict (post_id, tag_id) do nothing');
		expect(compiled.sql).toContain('delete from tags');
		expect(compiled.sql).toContain('inserted_links');
	});

	it('loads only public active post IDs for a purge retry', async () => {
		const { database, execute } = databaseReturning([{ publicPostIds: [2], tagId: 3 }]);

		await expect(findTagPurgeContext(database, 3)).resolves.toEqual({
			publicPostIds: [2],
			tagId: 3,
		});

		const compiled = new PgDialect().sqlToQuery(execute.mock.calls[0]?.[0]!);
		expect(compiled.sql).toContain("posts.visibility = 'public'");
		expect(compiled.sql).toContain("posts.status = 'active'");
	});
});
