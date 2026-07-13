import { describe, expect, it } from 'vitest';

import { createCommentInputSchema, MAX_COMMENT_BODY_LENGTH } from './comment';

describe('comment input', () => {
	it('accepts a form post ID and normalizes line endings', () => {
		expect(createCommentInputSchema.parse({ body: 'First\r\nSecond', postId: '42' })).toEqual({
			body: 'First\nSecond',
			postId: 42,
		});
	});

	it('rejects blank and oversized comments', () => {
		expect(createCommentInputSchema.safeParse({ body: '  \n', postId: 42 }).success).toBe(false);
		expect(
			createCommentInputSchema.safeParse({ body: 'a'.repeat(MAX_COMMENT_BODY_LENGTH + 1), postId: 42 })
				.success,
		).toBe(false);
	});
});
