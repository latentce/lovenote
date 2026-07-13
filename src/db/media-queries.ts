import { and, eq, isNotNull } from 'drizzle-orm';

import type { DeliverableMedia } from '../lib/media-delivery';
import type { Database } from './client';
import { mediaAssets } from './schema';

export async function findMediaForDelivery(
	database: Database,
	assetId: string,
): Promise<DeliverableMedia | null> {
	const media = await database.query.mediaAssets.findFirst({
		columns: {
			byteSize: true,
			deliveryRevision: true,
			etag: true,
			id: true,
			mimeType: true,
			objectKey: true,
			originalFilename: true,
			updatedAt: true,
		},
		where: and(
			eq(mediaAssets.id, assetId),
			eq(mediaAssets.uploadState, 'ready'),
			isNotNull(mediaAssets.postId),
		),
		with: {
			post: {
				columns: {
					authorId: true,
					status: true,
					visibility: true,
				},
			},
		},
	});

	if (!media?.etag || !media.post) return null;

	return {
		authorId: media.post.authorId,
		byteSize: media.byteSize,
		deliveryRevision: media.deliveryRevision,
		etag: media.etag,
		id: media.id,
		mimeType: media.mimeType,
		objectKey: media.objectKey,
		originalFilename: media.originalFilename,
		status: media.post.status,
		updatedAt: media.updatedAt,
		visibility: media.post.visibility,
	};
}
