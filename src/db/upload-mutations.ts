import { and, asc, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';

import type { MediaKind, RequestUploadInput } from '../lib/media';
import type { Database } from './client';
import { mediaAssets } from './schema';

interface PendingUpload extends RequestUploadInput {
	assetId: string;
	expiresAt: Date;
	kind: MediaKind;
	objectKey: string;
	uploaderId: string;
}

export async function recordPendingUpload(database: Database, upload: PendingUpload) {
	await database.insert(mediaAssets).values({
		id: upload.assetId,
		altText: upload.altText,
		byteSize: upload.byteSize,
		durationMs: upload.durationMs ?? null,
		expiresAt: upload.expiresAt,
		height: upload.height,
		kind: upload.kind,
		mimeType: upload.mimeType,
		objectKey: upload.objectKey,
		originalFilename: upload.originalFilename,
		uploaderId: upload.uploaderId,
		width: upload.width,
	});
}

export async function findOwnedUpload(database: Database, assetId: string, uploaderId: string) {
	return (
		(await database.query.mediaAssets.findFirst({
			columns: {
				byteSize: true,
				etag: true,
				expiresAt: true,
				id: true,
				kind: true,
				mimeType: true,
				objectKey: true,
				uploadState: true,
			},
			where: and(eq(mediaAssets.id, assetId), eq(mediaAssets.uploaderId, uploaderId)),
		})) ?? null
	);
}

export async function markUploadReady(
	database: Database,
	assetId: string,
	uploaderId: string,
	etag: string,
) {
	const updated = await database
		.update(mediaAssets)
		.set({ etag, updatedAt: new Date(), uploadState: 'ready' })
		.where(
			and(
				eq(mediaAssets.id, assetId),
				eq(mediaAssets.uploaderId, uploaderId),
				eq(mediaAssets.uploadState, 'pending'),
			),
		)
		.returning({ id: mediaAssets.id });

	return updated[0]?.id ?? null;
}

export function buildExpiredUploadsQuery(
	database: Pick<Database, 'select'>,
	now: Date,
	limit: number,
) {
	return database
		.select({ id: mediaAssets.id, objectKey: mediaAssets.objectKey })
		.from(mediaAssets)
		.where(
			and(
				isNull(mediaAssets.postId),
				isNotNull(mediaAssets.expiresAt),
				lte(mediaAssets.expiresAt, now),
			),
		)
		.orderBy(asc(mediaAssets.expiresAt), asc(mediaAssets.id))
		.limit(limit);
}

export async function listExpiredUploads(database: Database, now: Date, limit: number) {
	return buildExpiredUploadsQuery(database, now, limit);
}

export async function deleteExpiredUploadRecords(
	database: Database,
	assetIds: string[],
	now: Date,
) {
	if (assetIds.length === 0) return [];

	return database
		.delete(mediaAssets)
		.where(
			and(
				inArray(mediaAssets.id, assetIds),
				isNull(mediaAssets.postId),
				isNotNull(mediaAssets.expiresAt),
				lte(mediaAssets.expiresAt, now),
			),
		)
		.returning({ id: mediaAssets.id });
}
