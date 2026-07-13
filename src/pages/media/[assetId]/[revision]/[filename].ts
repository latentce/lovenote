import type { APIContext, APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { findMediaForDelivery } from '../../../../db/media-queries';
import {
	canDeliverMedia,
	evaluateMediaPreconditions,
	httpEtag,
	ifRangeAllowsRange,
	mediaCacheControl,
	mediaRouteMatches,
	parseMediaRange,
	type DeliverableMedia,
	type MediaRangeResult,
} from '../../../../lib/media-delivery';
import { mediaAssetIdSchema } from '../../../../lib/media';

function errorResponse(status: number, headOnly: boolean, headers?: HeadersInit) {
	const responseHeaders = new Headers({
		'Cache-Control': 'private, no-store',
		'Content-Type': 'text/plain; charset=utf-8',
		'X-Content-Type-Options': 'nosniff',
	});
	for (const [name, value] of new Headers(headers)) responseHeaders.set(name, value);

	return new Response(headOnly ? null : status === 404 ? 'Not found.' : 'Media unavailable.', {
		headers: responseHeaders,
		status,
	});
}

function filenameFromRequest(request: Request) {
	const encodedFilename = new URL(request.url).pathname.split('/').at(-1);
	if (!encodedFilename) return null;

	try {
		return decodeURIComponent(encodedFilename);
	} catch {
		return null;
	}
}

function responseHeaders(media: DeliverableMedia, cacheControl: string) {
	return new Headers({
		'Accept-Ranges': 'bytes',
		'Cache-Control': cacheControl,
		'Content-Type': media.mimeType,
		ETag: httpEtag(media.etag),
		'Last-Modified': media.updatedAt.toUTCString(),
		'X-Content-Type-Options': 'nosniff',
	});
}

function rangeHeaders(headers: Headers, range: Extract<MediaRangeResult, { kind: 'range' }>, size: number) {
	headers.set('Content-Length', String(range.length));
	headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
}

function routeFromContext({ params, request }: APIContext) {
	const assetId = params.assetId;
	const revisionValue = params.revision;
	const filename = filenameFromRequest(request);
	const parsedAssetId = mediaAssetIdSchema.safeParse(assetId);

	if (
		!parsedAssetId.success ||
		parsedAssetId.data !== assetId?.toLowerCase() ||
		!revisionValue ||
		!/^[1-9]\d*$/u.test(revisionValue) ||
		!filename
	) {
		return null;
	}

	const revision = Number(revisionValue);
	if (!Number.isSafeInteger(revision)) return null;

	return { assetId: parsedAssetId.data, filename, revision };
}

function objectMatchesRecord(object: R2Object, media: DeliverableMedia) {
	return (
		object.etag === media.etag &&
		object.size === media.byteSize &&
		object.httpMetadata?.contentType === media.mimeType
	);
}

function hasBody(object: R2Object): object is R2ObjectBody {
	return 'body' in object;
}

async function deliverMedia(context: APIContext, headOnly: boolean) {
	const route = routeFromContext(context);
	if (!route) return errorResponse(404, headOnly);

	try {
		const media = await findMediaForDelivery(context.locals.database, route.assetId);
		if (
			!media ||
			!mediaRouteMatches(media, route) ||
			!canDeliverMedia(media, context.locals.user)
		) {
			return errorResponse(404, headOnly);
		}

		const cacheControl = mediaCacheControl(media);
		const etag = httpEtag(media.etag);
		const headers = responseHeaders(media, cacheControl);
		const precondition = evaluateMediaPreconditions(
			context.request.headers,
			etag,
			media.updatedAt,
		);

		if (precondition === 'not-modified') {
			headers.delete('Content-Type');
			return new Response(null, { headers, status: 304 });
		}

		if (precondition === 'precondition-failed') {
			headers.set('Cache-Control', 'private, no-store');
			headers.delete('Content-Type');
			return new Response(null, { headers, status: 412 });
		}

		const requestedRange = parseMediaRange(context.request.headers.get('range'), media.byteSize);
		const range = ifRangeAllowsRange(
			context.request.headers.get('if-range'),
			etag,
			media.updatedAt,
		)
			? requestedRange
			: { kind: 'none' as const };

		if (range.kind === 'unsatisfiable') {
			return errorResponse(416, headOnly, {
				'Accept-Ranges': 'bytes',
				'Content-Range': `bytes */${media.byteSize}`,
			});
		}

		const object = headOnly
			? await env.MEDIA_BUCKET.head(media.objectKey)
			: await env.MEDIA_BUCKET.get(
					media.objectKey,
					range.kind === 'range'
						? { range: { length: range.length, offset: range.offset } }
						: undefined,
				);

		if (!object) return errorResponse(404, headOnly);

		if (!objectMatchesRecord(object, media)) {
			if (hasBody(object)) await object.body.cancel();
			console.error(
				JSON.stringify({
					assetId: media.id,
					event: 'media.delivery_metadata_mismatch',
				}),
			);
			return errorResponse(503, headOnly);
		}

		const status = range.kind === 'range' ? 206 : 200;
		if (range.kind === 'range') {
			rangeHeaders(headers, range, media.byteSize);
		} else {
			headers.set('Content-Length', String(media.byteSize));
		}

		let body: ReadableStream | null = null;
		if (!headOnly) {
			if (!hasBody(object)) return errorResponse(503, false);
			body = object.body;
		}

		return new Response(body, { headers, status });
	} catch (error) {
		console.error(
			JSON.stringify({
				assetId: route.assetId,
				event: 'media.delivery_failed',
				errorType: error instanceof Error ? error.name : 'UnknownError',
			}),
		);
		return errorResponse(503, headOnly);
	}
}

export const GET = ((context) => deliverMedia(context, false)) satisfies APIRoute;
export const HEAD = ((context) => deliverMedia(context, true)) satisfies APIRoute;

export const ALL = (() =>
	new Response('Method not allowed.', {
		headers: {
			Allow: 'GET, HEAD',
			'Cache-Control': 'private, no-store',
			'Content-Type': 'text/plain; charset=utf-8',
		},
		status: 405,
	})) satisfies APIRoute;
