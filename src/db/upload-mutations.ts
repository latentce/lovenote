import { and, eq } from 'drizzle-orm';

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
