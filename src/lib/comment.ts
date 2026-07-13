import { z } from 'zod';

export const MAX_COMMENT_BODY_LENGTH = 2_000;

const commentBodySchema = z
	.string()
	.max(
		MAX_COMMENT_BODY_LENGTH,
		`Comments must be ${MAX_COMMENT_BODY_LENGTH.toLocaleString()} characters or less.`,
	)
	.transform((body) => body.replace(/\r\n?/g, '\n'))
	.refine((body) => body.trim().length > 0, 'Write a comment before submitting.');

export const createCommentInputSchema = z.object({
	body: commentBodySchema,
	postId: z.coerce.number().int().positive(),
});

export type CreateCommentInput = z.infer<typeof createCommentInputSchema>;
