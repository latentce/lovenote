import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';

import {
	decodeArchiveCursor,
	encodeArchiveCursor,
	type ArchiveCursor,
} from '../lib/archive';
import type { Database } from './client';
import { mediaAssets, posts } from './schema';

export const PUBLIC_ARCHIVE_PAGE_SIZE = 40;

function afterArchiveCursor(cursor: ArchiveCursor | null): SQL | undefined {
	if (!cursor) {
		return undefined;
	}

	return or(
		lt(mediaAssets.createdAt, cursor.createdAt),
		and(eq(mediaAssets.createdAt, cursor.createdAt), lt(mediaAssets.id, cursor.id)),
	);
}

export function buildPublicArchiveQuery(
	database: Pick<Database, 'select'>,
	cursor: ArchiveCursor | null,
	limit: number,
) {
	return database
		.select({
			altText: mediaAssets.altText,
			attachmentOrder: mediaAssets.attachmentOrder,
			byteSize: mediaAssets.byteSize,
			createdAt: mediaAssets.createdAt,
			deliveryRevision: mediaAssets.deliveryRevision,
			durationMs: mediaAssets.durationMs,
			height: mediaAssets.height,
			id: mediaAssets.id,
			kind: mediaAssets.kind,
			mimeType: mediaAssets.mimeType,
			originalFilename: mediaAssets.originalFilename,
			postId: posts.id,
			width: mediaAssets.width,
		})
		.from(mediaAssets)
		.innerJoin(posts, eq(mediaAssets.postId, posts.id))
		.where(
			and(
				eq(mediaAssets.uploadState, 'ready'),
				eq(posts.status, 'active'),
				eq(posts.visibility, 'public'),
				afterArchiveCursor(cursor),
			),
		)
		.orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
		.limit(limit + 1);
}

export async function listPublicArchive(
	database: Database,
	cursorValue?: string | null,
	pageSize = PUBLIC_ARCHIVE_PAGE_SIZE,
) {
	const cursor = decodeArchiveCursor(cursorValue);
	const requestedLimit = Number.isFinite(pageSize) ? Math.trunc(pageSize) : PUBLIC_ARCHIVE_PAGE_SIZE;
	const limit = Math.min(Math.max(requestedLimit, 1), 100);
	const rows = await buildPublicArchiveQuery(database, cursor, limit);

	const hasNextPage = rows.length > limit;
	const items = hasNextPage ? rows.slice(0, limit) : rows;
	const finalAsset = items.at(-1);

	return {
		items,
		nextCursor:
			hasNextPage && finalAsset
				? encodeArchiveCursor({ createdAt: finalAsset.createdAt, id: finalAsset.id })
				: null,
	};
}

export type PublicArchiveItem = Awaited<ReturnType<typeof listPublicArchive>>['items'][number];
