import { describe, expect, it } from 'vitest';

import { toggleFavoriteInputSchema } from './favorite';

describe('favorite input', () => {
	it('coerces a form post ID to a positive integer', () => {
		expect(toggleFavoriteInputSchema.parse({ postId: '42' })).toEqual({ postId: 42 });
	});

	it.each(['', '0', '-1', '1.5', 'not-a-post'])('rejects invalid post ID %j', (postId) => {
		expect(toggleFavoriteInputSchema.safeParse({ postId }).success).toBe(false);
	});
});
