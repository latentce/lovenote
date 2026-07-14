import { z } from 'zod';

import type { AuthenticatedUser } from './auth';
import { isActiveMember, isOwner } from './authorization';
import { postTagIdsSchema } from './tag';

export const MAX_POST_BODY_LENGTH = 10_000;
export const MAX_POST_ATTACHMENTS = 4;

export const postVisibilitySchema = z.enum(['public', 'private']);

export const postLifecycleInputSchema = z.object({
	postId: z.coerce.number().int().positive(),
});

export const deletePostInputSchema = postLifecycleInputSchema.extend({
	confirmation: z.literal('delete'),
});

const postBodySchema = z.preprocess(
	(value) => (value === null ? '' : value),
	z
		.string()
		.max(MAX_POST_BODY_LENGTH, `Post text must be ${MAX_POST_BODY_LENGTH.toLocaleString()} characters or less.`)
		.transform((body) => body.replace(/\r\n?/g, '\n')),
);

function rejectDuplicateTags(tagIds: number[], context: z.core.$RefinementCtx) {
	if (new Set(tagIds).size !== tagIds.length) {
		context.addIssue({
			code: 'custom',
			message: 'Each tag can only be added once.',
			path: ['tagIds'],
		});
	}
}

export const editPostInputSchema = postLifecycleInputSchema
	.extend({
		body: postBodySchema,
		purgePublic: z
			.preprocess((value) => (value === null ? undefined : value), z.literal('true').optional())
			.transform((value) => value === 'true'),
		tagIds: postTagIdsSchema,
		visibility: postVisibilitySchema,
	})
	.superRefine(({ tagIds }, context) => rejectDuplicateTags(tagIds, context));

export const createPostInputSchema = z
	.object({
		body: postBodySchema,
		visibility: postVisibilitySchema,
		attachmentIds: z.array(z.uuid()).max(MAX_POST_ATTACHMENTS).default([]),
		tagIds: postTagIdsSchema,
	})
	.superRefine(({ attachmentIds, body, tagIds }, context) => {
		if (body.trim().length === 0 && attachmentIds.length === 0) {
			context.addIssue({
				code: 'custom',
				message: 'Add text or at least one attachment.',
				path: ['body'],
			});
		}

		if (new Set(attachmentIds).size !== attachmentIds.length) {
			context.addIssue({
				code: 'custom',
				message: 'Each attachment can only be added once.',
				path: ['attachmentIds'],
			});
		}

		rejectDuplicateTags(tagIds, context);
	});

export type CreatePostInput = z.infer<typeof createPostInputSchema>;
export type DeletePostInput = z.infer<typeof deletePostInputSchema>;
export type EditPostInput = z.infer<typeof editPostInputSchema>;
export type PostLifecycleInput = z.infer<typeof postLifecycleInputSchema>;
export type PostVisibility = z.infer<typeof postVisibilitySchema>;
export type PostStatus = 'active' | 'hidden' | 'deleting';

export interface VisiblePost {
	authorId: string;
	status: PostStatus;
	visibility: PostVisibility;
}

export function canViewPost(post: VisiblePost, viewer: AuthenticatedUser | null) {
	if (post.status === 'deleting') {
		return false;
	}

	if (post.status === 'hidden') {
		return isOwner(viewer) || (isActiveMember(viewer) && post.authorId === viewer.id);
	}

	return post.visibility === 'public' || isActiveMember(viewer);
}

export interface PostCursor {
	createdAt: Date;
	id: number;
}

const cursorPayloadSchema = z.tuple([z.iso.datetime({ offset: true }), z.number().int().positive()]);

export function encodePostCursor({ createdAt, id }: PostCursor) {
	return btoa(JSON.stringify([createdAt.toISOString(), id]))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/u, '');
}

export function decodePostCursor(value: string | null | undefined): PostCursor | null {
	if (!value) {
		return null;
	}

	try {
		const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
		const padding = '='.repeat((4 - (base64.length % 4)) % 4);
		const payload = cursorPayloadSchema.parse(JSON.parse(atob(base64 + padding)));

		return { createdAt: new Date(payload[0]), id: payload[1] };
	} catch {
		return null;
	}
}

export type PostBodyToken =
	| { kind: 'text'; text: string }
	| { href: string; kind: 'link'; text: string };

const urlCandidatePattern = /https?:\/\/[^\s<>"']+/giu;
const trailingUrlPunctuationPattern = /[.,!?;:]+$/u;
const closingPair = { ')': '(', ']': '[', '}': '{' } as const;

function trimUrlPunctuation(candidate: string) {
	let url = candidate.replace(trailingUrlPunctuationPattern, '');

	while (url.length > 0) {
		const finalCharacter = url.at(-1);
		if (!(finalCharacter && finalCharacter in closingPair)) {
			break;
		}

		const openingCharacter = closingPair[finalCharacter as keyof typeof closingPair];
		const openingCount = [...url].filter((character) => character === openingCharacter).length;
		const closingCount = [...url].filter((character) => character === finalCharacter).length;

		if (closingCount <= openingCount) {
			break;
		}

		url = url.slice(0, -1);
	}

	return url;
}

export function tokenizePostBody(body: string): PostBodyToken[] {
	const tokens: PostBodyToken[] = [];
	let previousEnd = 0;

	for (const match of body.matchAll(urlCandidatePattern)) {
		const start = match.index;
		const candidate = match[0];
		const href = trimUrlPunctuation(candidate);

		if (start > previousEnd) {
			tokens.push({ kind: 'text', text: body.slice(previousEnd, start) });
		}

		try {
			const url = new URL(href);
			if (url.protocol === 'http:' || url.protocol === 'https:') {
				tokens.push({ href, kind: 'link', text: href });
			} else {
				tokens.push({ kind: 'text', text: href });
			}
		} catch {
			tokens.push({ kind: 'text', text: href });
		}

		if (href.length < candidate.length) {
			tokens.push({ kind: 'text', text: candidate.slice(href.length) });
		}

		previousEnd = start + candidate.length;
	}

	if (previousEnd < body.length) {
		tokens.push({ kind: 'text', text: body.slice(previousEnd) });
	}

	return tokens;
}
