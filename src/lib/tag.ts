import { z } from 'zod';

export const MAX_TAG_NAME_LENGTH = 64;
export const MAX_TAG_SLUG_LENGTH = 64;
export const MAX_TAG_DESCRIPTION_LENGTH = 1_000;
export const MAX_POST_TAGS = 30;

export function normalizeTagSlug(value: string) {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/gu, '')
		.toLowerCase()
		.trim()
		.replace(/^#+/u, '')
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		.slice(0, MAX_TAG_SLUG_LENGTH)
		.replace(/-+$/u, '');
}

const tagIdSchema = z.coerce.number().int().positive();
const displayNameSchema = z
	.string()
	.trim()
	.min(1, 'Enter a tag name.')
	.max(MAX_TAG_NAME_LENGTH, `Tag names must be ${MAX_TAG_NAME_LENGTH} characters or less.`);
const slugSchema = z
	.string()
	.transform(normalizeTagSlug)
	.pipe(
		z
			.string()
			.min(1, 'Enter a tag slug containing letters or numbers.')
			.max(MAX_TAG_SLUG_LENGTH)
			.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Use a URL-safe tag slug.'),
	);
const descriptionSchema = z
	.string()
	.trim()
	.max(
		MAX_TAG_DESCRIPTION_LENGTH,
		`Tag descriptions must be ${MAX_TAG_DESCRIPTION_LENGTH.toLocaleString()} characters or less.`,
	);

const tagMetadataShape = {
	description: descriptionSchema,
	displayName: displayNameSchema,
	slug: slugSchema,
};

export const createTagInputSchema = z.object(tagMetadataShape);

export const updateTagInputSchema = z.object({
	tagId: tagIdSchema,
	...tagMetadataShape,
});

export const mergeTagInputSchema = z
	.object({
		confirmation: z.literal('merge'),
		sourceTagId: tagIdSchema,
		targetTagId: tagIdSchema,
	})
	.refine(({ sourceTagId, targetTagId }) => sourceTagId !== targetTagId, {
		message: 'Choose two different tags.',
		path: ['targetTagId'],
	});

export const retryTagPurgeInputSchema = z.object({
	staleTagId: tagIdSchema.optional(),
	tagId: tagIdSchema,
});

export type CreateTagInput = z.infer<typeof createTagInputSchema>;
export type MergeTagInput = z.infer<typeof mergeTagInputSchema>;
export type UpdateTagInput = z.infer<typeof updateTagInputSchema>;
