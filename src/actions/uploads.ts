import { ActionError, defineAction } from 'astro:actions';
import { env } from 'cloudflare:workers';

import { findOwnedUpload, markUploadReady, recordPendingUpload } from '../db/upload-mutations';
import {
	AuthorizationError,
	requireCapability,
	requireMember,
	requireOwner,
} from '../lib/authorization';
import {
	cleanupExpiredUploadsInputSchema,
	completeUploadInputSchema,
	mediaKindForMimeType,
	isSupportedMediaType,
	matchesMediaSignature,
	MEDIA_SIGNATURE_BYTE_COUNT,
	requestUploadInputSchema,
	signUploadUrl,
	UNATTACHED_UPLOAD_LIFETIME_MS,
	uploadedObjectMetadataMatches,
	type MediaKind,
} from '../lib/media';
import {
	cleanupExpiredUploads,
	OPPORTUNISTIC_UPLOAD_CLEANUP_LIMIT,
	OWNER_UPLOAD_CLEANUP_LIMIT,
} from '../lib/upload-cleanup';

function safeErrorType(error: unknown) {
	return error instanceof Error ? error.name : 'UnknownError';
}

function requireUploadMember(locals: App.Locals) {
	try {
		return requireMember(locals);
	} catch (error) {
		if (error instanceof AuthorizationError) {
			throw new ActionError({ code: 'UNAUTHORIZED', message: 'Sign in to manage uploads.' });
		}

		throw error;
	}
}

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

function authorizeUploadCleanup(locals: App.Locals) {
	try {
		return requireOwner(locals);
	} catch (error) {
		if (!(error instanceof AuthorizationError)) throw error;
		if (error.code === 'AUTHENTICATION_REQUIRED') {
			throw new ActionError({ code: 'UNAUTHORIZED', message: 'Sign in as the owner.' });
		}
		throw new ActionError({
			code: 'FORBIDDEN',
			message: 'Only the owner can run upload cleanup.',
		});
	}
}

export const uploadActions = {
	cleanupExpired: defineAction({
		accept: 'form',
		input: cleanupExpiredUploadsInputSchema,
		handler: async (_input, { locals }) => {
			const owner = authorizeUploadCleanup(locals);
			try {
				const result = await cleanupExpiredUploads(locals.database, env.MEDIA_BUCKET, {
					limit: OWNER_UPLOAD_CLEANUP_LIMIT,
				});
				console.info(
					JSON.stringify({
						deletedCount: result.deleted,
						event: 'upload.cleanup_completed',
						foundCount: result.found,
						userId: owner.id,
					}),
				);
				return result;
			} catch (error) {
				console.error(
					JSON.stringify({
						event: 'upload.cleanup_failed',
						errorType: safeErrorType(error),
						userId: owner.id,
					}),
				);
				throw new ActionError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'Expired uploads could not be cleaned up. Please try again.',
				});
			}
		},
	}),
	complete: defineAction({
		input: completeUploadInputSchema,
		handler: async ({ assetId }, { locals }) => {
			const member = requireUploadMember(locals);
			let upload = await findOwnedUpload(locals.database, assetId, member.id);

			if (!upload || !isSupportedMediaType(upload.mimeType)) {
				throw new ActionError({ code: 'NOT_FOUND', message: 'The upload was not found.' });
			}

			authorizeUpload(locals, upload.kind);

			if (upload.uploadState === 'ready') {
				return { assetId: upload.id, ready: true };
			}

			const now = new Date();
			const expired = !upload.expiresAt || upload.expiresAt <= now;
			let object: R2Object | null;

			try {
				object = await env.MEDIA_BUCKET.head(upload.objectKey);
			} catch (error) {
				console.error(
					JSON.stringify({
						assetId,
						event: 'upload.head_failed',
						errorType: safeErrorType(error),
						userId: member.id,
					}),
				);
				throw new ActionError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'The upload could not be verified. Try again later.',
				});
			}

			if (!object) {
				throw new ActionError({ code: 'CONFLICT', message: 'Upload the file before completing it.' });
			}

			const metadataMatches = uploadedObjectMetadataMatches(
				{ byteSize: upload.byteSize, mimeType: upload.mimeType },
				{ contentType: object.httpMetadata?.contentType, size: object.size },
			);
			let signatureMatches = false;

			if (!expired && metadataMatches) {
				try {
					const signatureObject = await env.MEDIA_BUCKET.get(upload.objectKey, {
						range: { length: Math.min(object.size, MEDIA_SIGNATURE_BYTE_COUNT), offset: 0 },
					});
					signatureMatches =
						signatureObject !== null &&
						matchesMediaSignature(upload.mimeType, new Uint8Array(await signatureObject.arrayBuffer()));
				} catch (error) {
					console.error(
						JSON.stringify({
							assetId,
							event: 'upload.signature_read_failed',
							errorType: safeErrorType(error),
							userId: member.id,
						}),
					);
					throw new ActionError({
						code: 'INTERNAL_SERVER_ERROR',
						message: 'The upload could not be verified. Try again later.',
					});
				}
			}

			if (expired || !metadataMatches || !signatureMatches) {
				try {
					await env.MEDIA_BUCKET.delete(upload.objectKey);
				} catch (error) {
					console.error(
						JSON.stringify({
							assetId,
							event: 'upload.rejected_object_cleanup_failed',
							errorType: safeErrorType(error),
							userId: member.id,
						}),
					);
					throw new ActionError({
						code: 'INTERNAL_SERVER_ERROR',
						message: 'The invalid upload could not be removed. Contact the owner.',
					});
				}

				console.warn(
					JSON.stringify({
						assetId,
						event: 'upload.rejected',
						reason: expired ? 'expired' : metadataMatches ? 'signature' : 'metadata',
						userId: member.id,
					}),
				);
				throw new ActionError({
					code: 'BAD_REQUEST',
					message: expired
						? 'The upload has expired. Start a new upload.'
						: 'The uploaded file does not match the requested media type or size.',
				});
			}

			const completedAssetId = await markUploadReady(
				locals.database,
				assetId,
				member.id,
				object.etag,
			);

			if (!completedAssetId) {
				upload = await findOwnedUpload(locals.database, assetId, member.id);
				if (upload?.uploadState !== 'ready') {
					throw new ActionError({
						code: 'CONFLICT',
						message: 'The upload state changed. Start a new upload.',
					});
				}
			}

			console.info(JSON.stringify({ assetId, event: 'upload.completed', userId: member.id }));

			return { assetId, ready: true };
		},
	}),
	request: defineAction({
		input: requestUploadInputSchema,
		handler: async (input, { locals }) => {
			if (!isSupportedMediaType(input.mimeType)) {
				throw new ActionError({ code: 'BAD_REQUEST', message: 'The media type is unsupported.' });
			}
			const kind = mediaKindForMimeType(input.mimeType);

			const uploader = authorizeUpload(locals, kind);
			try {
				const cleanup = await cleanupExpiredUploads(locals.database, env.MEDIA_BUCKET, {
					limit: OPPORTUNISTIC_UPLOAD_CLEANUP_LIMIT,
				});
				if (cleanup.deleted > 0) {
					console.info(
						JSON.stringify({
							deletedCount: cleanup.deleted,
							event: 'upload.cleanup_opportunistic',
						}),
					);
				}
			} catch (error) {
				console.error(
					JSON.stringify({
						event: 'upload.cleanup_opportunistic_failed',
						errorType: safeErrorType(error),
					}),
				);
			}
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
						errorType: safeErrorType(error),
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
