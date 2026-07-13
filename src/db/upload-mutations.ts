import { mediaAssets } from './schema';
import type { Database } from './client';
import type { MediaKind, RequestUploadInput } from '../lib/media';

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
