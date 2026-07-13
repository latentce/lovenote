import { describe, expect, it } from 'vitest';

import type { AuthenticatedUser } from './auth';
import {
	canViewPost,
	createPostInputSchema,
	deletePostInputSchema,
	decodePostCursor,
	editPostInputSchema,
	encodePostCursor,
	postLifecycleInputSchema,
	tokenizePostBody,
} from './post';

const member = {
	id: 'member-id',
	name: 'Member',
	email: 'member@users.invalid',
	emailVerified: false,
	username: 'member',
	displayUsername: 'Member',
	role: 'user',
	banned: false,
} as AuthenticatedUser;

const owner = { ...member, id: 'owner-id', role: 'admin' } as AuthenticatedUser;
const author = { ...member, id: 'author-id' } as AuthenticatedUser;
const attachmentId = '3df91f2d-582c-4d2a-b24d-c42d2ed58f7d';

describe('post input', () => {
	it.each([
		{ body: 'Text only', visibility: 'public' as const },
		{ body: '', visibility: 'private' as const, attachmentIds: [attachmentId] },
		{ body: 'Text and media', visibility: 'public' as const, attachmentIds: [attachmentId] },
	])('accepts valid text and media combinations', (input) => {
		expect(createPostInputSchema.safeParse(input).success).toBe(true);
	});

	it('normalizes line endings without rendering markup', () => {
		const result = createPostInputSchema.parse({ body: 'one\r\ntwo\rthree', visibility: 'public' });
		expect(result.body).toBe('one\ntwo\nthree');
	});

	it('requires text or an attachment', () => {
		expect(createPostInputSchema.safeParse({ body: '  \n', visibility: 'public' }).success).toBe(
			false,
		);
		expect(createPostInputSchema.safeParse({ body: null, visibility: 'private' }).success).toBe(false);
	});

	it('enforces the body and attachment limits', () => {
		expect(
			createPostInputSchema.safeParse({ body: 'a'.repeat(10_001), visibility: 'public' }).success,
		).toBe(false);
		expect(
			createPostInputSchema.safeParse({
				body: '',
				visibility: 'private',
				attachmentIds: Array.from({ length: 5 }, (_, index) =>
					`3df91f2d-582c-4d2a-b24d-c42d2ed58f7${index}`,
				),
			}).success,
		).toBe(false);
	});

	it('rejects duplicate attachment IDs', () => {
		expect(
			createPostInputSchema.safeParse({
				body: '',
				visibility: 'private',
				attachmentIds: [attachmentId, attachmentId],
			}).success,
		).toBe(false);
	});

	it('coerces tag form values and rejects duplicates or more than 30 tags', () => {
		expect(
			createPostInputSchema.parse({ body: 'Tagged', tagIds: ['2', '7'], visibility: 'public' })
				.tagIds,
		).toEqual([2, 7]);
		expect(
			createPostInputSchema.safeParse({ body: 'Tagged', tagIds: ['2', '2'], visibility: 'public' })
				.success,
		).toBe(false);
		expect(
			createPostInputSchema.safeParse({
				body: 'Tagged',
				tagIds: Array.from({ length: 31 }, (_, index) => index + 1),
				visibility: 'public',
			}).success,
		).toBe(false);
	});
});

describe('post visibility', () => {
	it('shows active public posts to everyone and active private posts only to members', () => {
		expect(canViewPost({ authorId: author.id, status: 'active', visibility: 'public' }, null)).toBe(
			true,
		);
		expect(canViewPost({ authorId: author.id, status: 'active', visibility: 'private' }, null)).toBe(
			false,
		);
		expect(
			canViewPost({ authorId: author.id, status: 'active', visibility: 'private' }, member),
		).toBe(true);
	});

	it('limits hidden posts to their author and the owner', () => {
		const hiddenPost = { authorId: author.id, status: 'hidden' as const, visibility: 'public' as const };
		expect(canViewPost(hiddenPost, null)).toBe(false);
		expect(canViewPost(hiddenPost, member)).toBe(false);
		expect(canViewPost(hiddenPost, author)).toBe(true);
		expect(canViewPost(hiddenPost, owner)).toBe(true);
	});

	it('never exposes deleting posts', () => {
		const deletingPost = {
			authorId: author.id,
			status: 'deleting' as const,
			visibility: 'public' as const,
		};
		expect(canViewPost(deletingPost, author)).toBe(false);
		expect(canViewPost(deletingPost, owner)).toBe(false);
	});
});

describe('post lifecycle input', () => {
	it('coerces a form post ID to a positive integer', () => {
		expect(postLifecycleInputSchema.parse({ postId: '42' })).toEqual({ postId: 42 });
	});

	it.each(['', '0', '-1', '1.5', 'not-a-post'])('rejects invalid post ID %j', (postId) => {
		expect(postLifecycleInputSchema.safeParse({ postId }).success).toBe(false);
	});

	it('requires explicit permanent-deletion confirmation', () => {
		expect(deletePostInputSchema.safeParse({ confirmation: 'delete', postId: '42' }).success).toBe(true);
		expect(deletePostInputSchema.safeParse({ confirmation: 'keep', postId: '42' }).success).toBe(false);
	});
});

describe('post edit input', () => {
	it('normalizes form values while allowing the database to validate media-only posts', () => {
			expect(editPostInputSchema.parse({ body: 'one\r\ntwo', postId: '42', visibility: 'private' })).toEqual({
			body: 'one\ntwo',
			postId: 42,
			purgePublic: false,
			tagIds: [],
			visibility: 'private',
		});
		expect(editPostInputSchema.safeParse({ body: '', postId: '42', visibility: 'public' }).success).toBe(true);
	});

	it('enforces post text and visibility limits', () => {
		expect(editPostInputSchema.safeParse({ body: 'a'.repeat(10_001), postId: 42, visibility: 'public' }).success).toBe(false);
		expect(editPostInputSchema.safeParse({ body: 'Post', postId: 42, visibility: 'friends' }).success).toBe(false);
	});

	it('accepts only the internal public-purge retry marker', () => {
		expect(editPostInputSchema.parse({ body: 'Post', postId: 42, purgePublic: 'true', visibility: 'private' }).purgePublic).toBe(true);
		expect(editPostInputSchema.safeParse({ body: 'Post', postId: 42, purgePublic: 'false', visibility: 'private' }).success).toBe(false);
	});
});

describe('post cursors', () => {
	it('round trips the chronology and numeric ID', () => {
		const cursor = { createdAt: new Date('2026-07-13T17:42:00.123Z'), id: 42 };
		expect(decodePostCursor(encodePostCursor(cursor))).toEqual(cursor);
	});

	it.each(['not-base64', btoa('{}'), btoa(JSON.stringify(['not-a-date', 1])), ''])(
		'rejects an invalid cursor',
		(cursor) => {
			expect(decodePostCursor(cursor)).toBeNull();
		},
	);
});

describe('plain-text post links', () => {
	it('linkifies only HTTP and HTTPS URLs while preserving punctuation and line breaks', () => {
		expect(tokenizePostBody('See https://example.com/a_(b).\nThen http://example.org!')).toEqual([
			{ kind: 'text', text: 'See ' },
			{ href: 'https://example.com/a_(b)', kind: 'link', text: 'https://example.com/a_(b)' },
			{ kind: 'text', text: '.' },
			{ kind: 'text', text: '\nThen ' },
			{ href: 'http://example.org', kind: 'link', text: 'http://example.org' },
			{ kind: 'text', text: '!' },
		]);
	});

	it('keeps markup and non-web protocols as inert text tokens', () => {
		const body = '<script>alert(1)</script> javascript:alert(1) data:text/html,x';
		expect(tokenizePostBody(body)).toEqual([{ kind: 'text', text: body }]);
	});

	it('does not include an HTML attribute boundary in a link', () => {
		expect(tokenizePostBody('https://example.com\" onmouseover=alert(1)')).toEqual([
			{ href: 'https://example.com', kind: 'link', text: 'https://example.com' },
			{ kind: 'text', text: '\" onmouseover=alert(1)' },
		]);
	});
});
