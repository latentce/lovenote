import { drizzle } from 'drizzle-orm/neon-http';
import { describe, expect, it } from 'vitest';

import { buildPublicArchiveQuery } from './archive-queries';
import { schema } from './client';

describe('public archive query', () => {
	it('isolates ready media on active public posts in one cursor query', () => {
		const database = drizzle.mock({ schema });
		const cursor = {
			createdAt: new Date('2026-07-13T18:00:00.000Z'),
			id: '0198a34b-2f56-7c8d-9e01-123456789abc',
		};
		const query = buildPublicArchiveQuery(database, cursor, 40).toSQL();

		expect(query.sql).toContain('inner join "posts"');
		expect(query.sql).toContain('"media_assets"."created_at" desc');
		expect(query.sql).toContain('"media_assets"."id" desc');
		expect(query.sql.toLowerCase()).not.toContain(' offset ');
		expect(query.sql).not.toContain('object_key');
		expect(query.params).toContain('ready');
		expect(query.params).toContain('active');
		expect(query.params).toContain('public');
		expect(query.params).toContain(cursor.id);
		expect(query.params).toContain(41);
	});
});
