import { describe, expect, it } from 'vitest';

import type { AuthenticatedUser } from './auth';
import {
	canDeliverMedia,
	evaluateMediaPreconditions,
	httpEtag,
	ifRangeAllowsRange,
	mediaCacheControl,
	mediaDeliveryUrl,
	mediaRouteMatches,
	parseMediaRange,
	PRIVATE_MEDIA_CACHE_CONTROL,
	PUBLIC_MEDIA_CACHE_CONTROL,
	type DeliverableMedia,
} from './media-delivery';

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
const author = { ...member, id: 'author-id' } as AuthenticatedUser;
const owner = { ...member, id: 'owner-id', role: 'admin' } as AuthenticatedUser;
const bannedMember = { ...member, banned: true } as AuthenticatedUser;

const media: DeliverableMedia = {
	authorId: author.id,
	byteSize: 1_000,
	deliveryRevision: 2,
	etag: 'abc123',
	id: '3df91f2d-582c-4d2a-b24d-c42d2ed58f7d',
	mimeType: 'image/jpeg',
	objectKey: 'uploads/asset-id',
	originalFilename: 'summer photo #1.jpg',
	status: 'active',
	updatedAt: new Date('2026-07-13T18:00:00.000Z'),
	visibility: 'public',
};

describe('media delivery visibility and URLs', () => {
	it('creates one canonical encoded delivery URL and rejects stale route values', () => {
		expect(mediaDeliveryUrl(media)).toBe(
			'/media/3df91f2d-582c-4d2a-b24d-c42d2ed58f7d/2/summer%20photo%20%231.jpg',
		);
		expect(
			mediaRouteMatches(media, {
				assetId: media.id,
				filename: media.originalFilename,
				revision: media.deliveryRevision,
			}),
		).toBe(true);
		expect(
			mediaRouteMatches(media, {
				assetId: media.id,
				filename: media.originalFilename,
				revision: media.deliveryRevision - 1,
			}),
		).toBe(false);
	});

	it('serves active public media anonymously with immutable caching', () => {
		expect(canDeliverMedia(media, null)).toBe(true);
		expect(mediaCacheControl(media)).toBe(PUBLIC_MEDIA_CACHE_CONTROL);
	});

	it('requires a member for private media and disables shared caching', () => {
		const privateMedia = { ...media, visibility: 'private' as const };
		expect(canDeliverMedia(privateMedia, null)).toBe(false);
		expect(canDeliverMedia(privateMedia, bannedMember)).toBe(false);
		expect(canDeliverMedia(privateMedia, member)).toBe(true);
		expect(mediaCacheControl(privateMedia)).toBe(PRIVATE_MEDIA_CACHE_CONTROL);
	});

	it('limits hidden media to the author and owner and never serves deleting media', () => {
		const hiddenMedia = { ...media, status: 'hidden' as const };
		expect(canDeliverMedia(hiddenMedia, member)).toBe(false);
		expect(canDeliverMedia(hiddenMedia, author)).toBe(true);
		expect(canDeliverMedia(hiddenMedia, owner)).toBe(true);
		expect(mediaCacheControl(hiddenMedia)).toBe(PRIVATE_MEDIA_CACHE_CONTROL);
		expect(canDeliverMedia({ ...media, status: 'deleting' }, owner)).toBe(false);
	});
});

describe('media byte ranges', () => {
	it.each([
		['bytes=0-99', { kind: 'range', length: 100, offset: 0 }],
		['bytes=900-', { kind: 'range', length: 100, offset: 900 }],
		['bytes=-100', { kind: 'range', length: 100, offset: 900 }],
		['bytes=950-2000', { kind: 'range', length: 50, offset: 950 }],
	] as const)('parses %s', (header, expected) => {
		expect(parseMediaRange(header, media.byteSize)).toEqual(expected);
	});

	it.each(['bytes=1000-', 'bytes=100-99', 'bytes=-0', 'bytes=0-1,4-5', 'items=0-1'])(
		'rejects an invalid or unsupported range: %s',
		(header) => {
			expect(parseMediaRange(header, media.byteSize)).toEqual({ kind: 'unsatisfiable' });
		},
	);

	it('ignores no range header', () => {
		expect(parseMediaRange(null, media.byteSize)).toEqual({ kind: 'none' });
	});
});

describe('media conditional requests', () => {
	const etag = httpEtag(media.etag);

	it('returns not modified for matching entity tags and dates', () => {
		expect(evaluateMediaPreconditions(new Headers({ 'If-None-Match': etag }), etag, media.updatedAt)).toBe(
			'not-modified',
		);
		expect(
			evaluateMediaPreconditions(
				new Headers({ 'If-None-Match': `W/${etag}` }),
				etag,
				media.updatedAt,
			),
		).toBe('not-modified');
		expect(
			evaluateMediaPreconditions(
				new Headers({ 'If-Modified-Since': media.updatedAt.toUTCString() }),
				etag,
				media.updatedAt,
			),
		).toBe('not-modified');
	});

	it('returns precondition failed for stale write preconditions', () => {
		expect(
			evaluateMediaPreconditions(new Headers({ 'If-Match': '"different"' }), etag, media.updatedAt),
		).toBe('precondition-failed');
		expect(
			evaluateMediaPreconditions(
				new Headers({ 'If-Unmodified-Since': '2026-07-13T17:59:59.000Z' }),
				etag,
				media.updatedAt,
			),
		).toBe('precondition-failed');
	});

	it('gives entity tags precedence over date conditions', () => {
		expect(
			evaluateMediaPreconditions(
				new Headers({
					'If-Modified-Since': '2026-07-14T00:00:00.000Z',
					'If-None-Match': '"different"',
				}),
				etag,
				media.updatedAt,
			),
		).toBe('proceed');
	});

	it('uses only strong matching validators for If-Range entity tags', () => {
		expect(ifRangeAllowsRange(etag, etag, media.updatedAt)).toBe(true);
		expect(ifRangeAllowsRange(`W/${etag}`, etag, media.updatedAt)).toBe(false);
		expect(ifRangeAllowsRange('"different"', etag, media.updatedAt)).toBe(false);
		expect(ifRangeAllowsRange(media.updatedAt.toUTCString(), etag, media.updatedAt)).toBe(true);
	});
});
