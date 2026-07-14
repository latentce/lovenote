import type { AuthenticatedUser } from './auth';
import { canViewPost, type PostStatus, type PostVisibility } from './post';

export const PUBLIC_MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const PRIVATE_MEDIA_CACHE_CONTROL = 'private, no-store';
export const MEDIA_RESPONSE_VARY = [
	'If-Match',
	'If-Modified-Since',
	'If-None-Match',
	'If-Range',
	'If-Unmodified-Since',
	'Range',
].join(', ');
const MEDIA_VARIANT_REQUEST_HEADERS = MEDIA_RESPONSE_VARY.split(', ');

export interface DeliverableMedia {
	authorId: string;
	byteSize: number;
	deliveryRevision: number;
	etag: string;
	id: string;
	mimeType: string;
	objectKey: string;
	originalFilename: string;
	status: PostStatus;
	updatedAt: Date;
	visibility: PostVisibility;
}

export function mediaDeliveryUrl(
	media: Pick<DeliverableMedia, 'deliveryRevision' | 'id' | 'originalFilename'>,
) {
	return `/media/${media.id}/${media.deliveryRevision}/${encodeURIComponent(media.originalFilename)}`;
}

export function mediaRouteMatches(
	media: Pick<DeliverableMedia, 'deliveryRevision' | 'id' | 'originalFilename'>,
	route: { assetId: string; filename: string; revision: number },
) {
	return (
		media.id === route.assetId &&
		media.deliveryRevision === route.revision &&
		media.originalFilename === route.filename
	);
}

export function canDeliverMedia(media: DeliverableMedia, viewer: AuthenticatedUser | null) {
	return canViewPost(
		{
			authorId: media.authorId,
			status: media.status,
			visibility: media.visibility,
		},
		viewer,
	);
}

export function mediaCacheControl(media: Pick<DeliverableMedia, 'status' | 'visibility'>) {
	return media.status === 'active' && media.visibility === 'public'
		? PUBLIC_MEDIA_CACHE_CONTROL
		: PRIVATE_MEDIA_CACHE_CONTROL;
}

export function canCacheMediaRequest(
	media: Pick<DeliverableMedia, 'status' | 'visibility'>,
	request: Request,
	headOnly: boolean,
) {
	return (
		!headOnly &&
		media.status === 'active' &&
		media.visibility === 'public' &&
		MEDIA_VARIANT_REQUEST_HEADERS.every((header) => !request.headers.has(header))
	);
}

export function httpEtag(etag: string) {
	return `"${etag}"`;
}

function modifiedAtSeconds(date: Date) {
	return Math.floor(date.getTime() / 1000);
}

function parsedHttpDate(value: string) {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function entityTags(value: string) {
	return value.split(',').map((tag) => tag.trim());
}

function weakEntityTag(tag: string) {
	return tag.startsWith('W/') ? tag.slice(2) : tag;
}

export type MediaPreconditionResult = 'proceed' | 'not-modified' | 'precondition-failed';

export function evaluateMediaPreconditions(
	headers: Headers,
	etag: string,
	lastModified: Date,
): MediaPreconditionResult {
	const ifMatch = headers.get('if-match');
	if (ifMatch) {
		const matches = entityTags(ifMatch).some((candidate) => candidate === '*' || candidate === etag);
		if (!matches) return 'precondition-failed';
	} else {
		const ifUnmodifiedSince = headers.get('if-unmodified-since');
		const unmodifiedSince = ifUnmodifiedSince ? parsedHttpDate(ifUnmodifiedSince) : null;
		if (
			unmodifiedSince &&
			modifiedAtSeconds(lastModified) > modifiedAtSeconds(unmodifiedSince)
		) {
			return 'precondition-failed';
		}
	}

	const ifNoneMatch = headers.get('if-none-match');
	if (ifNoneMatch) {
		const matches = entityTags(ifNoneMatch).some(
			(candidate) => candidate === '*' || weakEntityTag(candidate) === etag,
		);
		if (matches) return 'not-modified';
	} else {
		const ifModifiedSince = headers.get('if-modified-since');
		const modifiedSince = ifModifiedSince ? parsedHttpDate(ifModifiedSince) : null;
		if (modifiedSince && modifiedAtSeconds(lastModified) <= modifiedAtSeconds(modifiedSince)) {
			return 'not-modified';
		}
	}

	return 'proceed';
}

export function ifRangeAllowsRange(value: string | null, etag: string, lastModified: Date) {
	if (!value) return true;
	if (value.startsWith('W/')) return false;
	if (value.startsWith('"')) return value === etag;

	const date = parsedHttpDate(value);
	return date !== null && modifiedAtSeconds(lastModified) <= modifiedAtSeconds(date);
}

export type MediaRangeResult =
	| { kind: 'none' }
	| { kind: 'range'; length: number; offset: number }
	| { kind: 'unsatisfiable' };

export function parseMediaRange(value: string | null, size: number): MediaRangeResult {
	if (!value) return { kind: 'none' };
	if (!Number.isSafeInteger(size) || size <= 0) return { kind: 'unsatisfiable' };

	const match = /^bytes=(\d*)-(\d*)$/iu.exec(value.trim());
	if (!match) return { kind: 'unsatisfiable' };

	const startValue = match[1];
	const endValue = match[2];
	if (!startValue && !endValue) return { kind: 'unsatisfiable' };

	if (!startValue) {
		const suffix = Number(endValue);
		if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: 'unsatisfiable' };
		const length = Math.min(suffix, size);
		return { kind: 'range', length, offset: size - length };
	}

	const start = Number(startValue);
	const requestedEnd = endValue ? Number(endValue) : size - 1;
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(requestedEnd) ||
		start >= size ||
		requestedEnd < start
	) {
		return { kind: 'unsatisfiable' };
	}

	const end = Math.min(requestedEnd, size - 1);
	return { kind: 'range', length: end - start + 1, offset: start };
}
