import { drizzle } from 'drizzle-orm/neon-http';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from './client';
import { schema } from './client';
import { buildExpiredUploadsQuery, deleteExpiredUploadRecords } from './upload-mutations';

describe('expired upload mutations', () => {
	it('selects only expired unattached uploads in deterministic batches', () => {
		const database = drizzle.mock({ schema });
		const now = new Date('2026-07-13T22:00:00.000Z');
		const query = buildExpiredUploadsQuery(database, now, 100).toSQL();

		expect(query.sql).toContain('"media_assets"."post_id" is null');
		expect(query.sql).toContain('"media_assets"."expires_at" is not null');
		expect(query.sql).toContain('"media_assets"."expires_at" <= $');
		expect(query.sql).toContain('order by "media_assets"."expires_at" asc');
		expect(query.params).toContain(now.toISOString());
		expect(query.params).toContain(100);
	});

	it('rechecks expiry and attachment state before deleting metadata', async () => {
		const returning = vi.fn().mockResolvedValue([{ id: 'asset-id' }]);
		const where = vi.fn().mockReturnValue({ returning });
		const database = {
			delete: vi.fn().mockReturnValue({ where }),
		} as unknown as Database;
		const now = new Date('2026-07-13T22:00:00.000Z');

		await expect(deleteExpiredUploadRecords(database, ['asset-id'], now)).resolves.toEqual([
			{ id: 'asset-id' },
		]);
		expect(where).toHaveBeenCalledOnce();
		expect(returning).toHaveBeenCalledOnce();
	});

	it('skips an empty metadata deletion', async () => {
		const database = { delete: vi.fn() } as unknown as Database;
		await expect(deleteExpiredUploadRecords(database, [], new Date())).resolves.toEqual([]);
		expect(database.delete).not.toHaveBeenCalled();
	});
});
