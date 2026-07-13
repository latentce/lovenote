import { describe, expect, it } from 'vitest';

import {
	createCommentInputSchema,
	deleteCommentInputSchema,
	MAX_COMMENT_BODY_LENGTH,
	moderateCommentInputSchema,
	retryCommentPurgeInputSchema,
} from './comment';

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

describe('comment moderation input', () => {
	it('coerces positive comment and post IDs from standard HTML forms', () => {
		expect(moderateCommentInputSchema.parse({ commentId: '42' })).toEqual({ commentId: 42 });
		expect(retryCommentPurgeInputSchema.parse({ postId: '17' })).toEqual({ postId: 17 });
	});

	it('requires explicit confirmation for permanent deletion', () => {
		expect(deleteCommentInputSchema.safeParse({ commentId: 42 }).success).toBe(false);
		expect(
			deleteCommentInputSchema.parse({ commentId: '42', confirmation: 'delete' }),
		).toEqual({ commentId: 42, confirmation: 'delete' });
	});

	it('rejects non-positive and fractional identifiers', () => {
		for (const commentId of ['0', '-1', '1.5', 'not-a-number']) {
			expect(moderateCommentInputSchema.safeParse({ commentId }).success).toBe(false);
		}
	});
});
