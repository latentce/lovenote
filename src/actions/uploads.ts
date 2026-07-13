import { ActionError, defineAction } from 'astro:actions';
import { env } from 'cloudflare:workers';

import { recordPendingUpload } from '../db/upload-mutations';
import { AuthorizationError, requireCapability } from '../lib/authorization';
import {
	mediaKindForMimeType,
	isSupportedMediaType,
	requestUploadInputSchema,
	signUploadUrl,
	UNATTACHED_UPLOAD_LIFETIME_MS,
	type MediaKind,
} from '../lib/media';

function authorizeUpload(locals: App.Locals, kind: MediaKind) {
	try {
		return requireCapability(locals, kind === 'image' ? 'uploadImages' : 'uploadVideos');
	} catch (error) {
		if (!(error instanceof AuthorizationError)) {
			throw error;
		}

		if (error.code === 'AUTHENTICATION_REQUIRED') {
			throw new ActionError({ code: 'UNAUTHORIZED', message: 'Sign in to upload media.' });
		}

		if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
			throw new ActionError({
				code: 'FORBIDDEN',
				message: 'Change your temporary password before uploading media.',
			});
		}

		throw new ActionError({
			code: 'FORBIDDEN',
			message: `You do not have permission to upload ${kind === 'image' ? 'images' : 'videos'}.`,
		});
	}
}

export const uploadActions = {
	request: defineAction({
		input: requestUploadInputSchema,
		handler: async (input, { locals }) => {
			if (!isSupportedMediaType(input.mimeType)) {
				throw new ActionError({ code: 'BAD_REQUEST', message: 'The media type is unsupported.' });
			}
			const kind = mediaKindForMimeType(input.mimeType);

			const uploader = authorizeUpload(locals, kind);
			const assetId = crypto.randomUUID();
			const objectKey = `uploads/${assetId}`;
			const now = new Date();
			let signedUpload;

			try {
				signedUpload = await signUploadUrl({
					accessKeyId: env.R2_ACCESS_KEY_ID,
					accountId: env.R2_ACCOUNT_ID,
					bucketName: env.R2_BUCKET_NAME,
					contentType: input.mimeType,
					now,
					objectKey,
					secretAccessKey: env.R2_SECRET_ACCESS_KEY,
				});
			} catch (error) {
				console.error(
					JSON.stringify({
						event: 'upload.signing_failed',
						error: error instanceof Error ? error.message : 'unknown',
						userId: uploader.id,
					}),
				);
				throw new ActionError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'The upload could not be prepared. Try again later.',
				});
			}

			await recordPendingUpload(locals.database, {
				...input,
				assetId,
				expiresAt: new Date(now.getTime() + UNATTACHED_UPLOAD_LIFETIME_MS),
				kind,
				objectKey,
				uploaderId: uploader.id,
			});

			console.info(
				JSON.stringify({
					assetId,
					byteSize: input.byteSize,
					event: 'upload.requested',
					kind,
					userId: uploader.id,
				}),
			);

			return {
				assetId,
				expiresAt: signedUpload.expiresAt.toISOString(),
				headers: signedUpload.headers,
				uploadUrl: signedUpload.uploadUrl.toString(),
			};
		},
	}),
};
