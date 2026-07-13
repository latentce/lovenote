import type { Database } from '../db/client';
import { deleteExpiredUploadRecords, listExpiredUploads } from '../db/upload-mutations';
import { deleteR2Objects } from './r2-cleanup';

export const OPPORTUNISTIC_UPLOAD_CLEANUP_LIMIT = 25;
export const OWNER_UPLOAD_CLEANUP_LIMIT = 100;

interface ExpiredUpload {
	id: string;
	objectKey: string;
}

export async function cleanupExpiredUploadBatch(
	bucket: Pick<R2Bucket, 'delete'>,
	uploads: ExpiredUpload[],
	deleteMetadata: (assetIds: string[]) => Promise<Array<{ id: string }>>,
) {
	if (uploads.length === 0) return { deleted: 0, found: 0 };

	await deleteR2Objects(
		bucket,
		uploads.map((upload) => upload.objectKey),
	);
	const deleted = await deleteMetadata(uploads.map((upload) => upload.id));

	return { deleted: deleted.length, found: uploads.length };
}

export async function cleanupExpiredUploads(
	database: Database,
	bucket: Pick<R2Bucket, 'delete'>,
	options: { limit: number; now?: Date },
) {
	const now = options.now ?? new Date();
	const uploads = await listExpiredUploads(database, now, options.limit);
	return cleanupExpiredUploadBatch(
		bucket,
		uploads,
		(assetIds) => deleteExpiredUploadRecords(database, assetIds, now),
	);
}
