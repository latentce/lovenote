import { describe, expect, it, vi } from 'vitest';

import type { Database } from './client';
import {
	completeCachePurgeJob,
	markCachePurgeJobFailed,
	recordCachePurgeJob,
} from './cache-purge-jobs';

describe('durable cache purge recovery', () => {
	it('records a de-duplicated set of tags for a failed privacy purge', async () => {
		const returning = vi.fn().mockResolvedValue([{ id: 7 }]);
		const values = vi.fn().mockReturnValue({ returning });
		const database = { insert: vi.fn().mockReturnValue({ values }) } as unknown as Database;

		await expect(recordCachePurgeJob(database, {
			errorType: 'CacheProviderFailure',
			operation: 'post-edit-access-reduction',
			postId: 42,
			tags: ['post:42', 'media:asset:1', 'post:42'],
		})).resolves.toBe(7);

		expect(values).toHaveBeenCalledWith(expect.objectContaining({
			lastErrorType: 'CacheProviderFailure',
			postId: 42,
			tags: ['post:42', 'media:asset:1'],
		}));
	});

	it('increments retry metadata without deleting a failed job', async () => {
		const returning = vi.fn().mockResolvedValue([{ id: 7 }]);
		const where = vi.fn().mockReturnValue({ returning });
		const set = vi.fn().mockReturnValue({ where });
		const database = { update: vi.fn().mockReturnValue({ set }) } as unknown as Database;

		await expect(markCachePurgeJobFailed(database, 7, 'RetryFailure')).resolves.toBe(7);
		expect(set).toHaveBeenCalledWith(expect.objectContaining({ lastErrorType: 'RetryFailure' }));
		expect(where).toHaveBeenCalledOnce();
	});

	it('deletes a job only after a successful purge', async () => {
		const returning = vi.fn().mockResolvedValue([{ id: 7 }]);
		const where = vi.fn().mockReturnValue({ returning });
		const database = { delete: vi.fn().mockReturnValue({ where }) } as unknown as Database;

		await expect(completeCachePurgeJob(database, 7)).resolves.toBe(7);
		expect(where).toHaveBeenCalledOnce();
	});
});
