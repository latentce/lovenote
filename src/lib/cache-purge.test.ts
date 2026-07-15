import { describe, expect, it } from 'vitest';

import { retryCachePurgeInputSchema } from './cache-purge';

describe('cache purge recovery input', () => {
	it('accepts a positive safe job identifier from an HTML form', () => {
		expect(retryCachePurgeInputSchema.parse({ jobId: '42' })).toEqual({ jobId: 42 });
	});

	it.each(['', '0', '-1', '1.5', 'not-a-job'])('rejects invalid job identifier %j', (jobId) => {
		expect(retryCachePurgeInputSchema.safeParse({ jobId }).success).toBe(false);
	});
});
