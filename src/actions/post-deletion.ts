import { env } from 'cloudflare:workers';
import { ActionError, defineAction } from 'astro:actions';

import {
	finalizePostDeletion,
	stagePostDeletion,
} from '../db/post-deletion-mutations';
import { AuthorizationError, isOwner, requireCapability } from '../lib/authorization';
import { postDeletionCacheTags } from '../lib/cache-invalidation';
import { deletePostInputSchema } from '../lib/post';
import { deleteR2Objects } from '../lib/r2-cleanup';

type CleanupPhase = 'cache' | 'database' | 'storage';

function authorizePostDeletion(locals: App.Locals) {
	try {
		return requireCapability(locals, 'deleteOwnPosts');
	} catch (error) {
		if (!(error instanceof AuthorizationError)) throw error;

		if (error.code === 'AUTHENTICATION_REQUIRED') {
			throw new ActionError({ code: 'UNAUTHORIZED', message: 'Sign in to delete posts.' });
		}

		if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
			throw new ActionError({
				code: 'FORBIDDEN',
				message: 'Change your temporary password before deleting posts.',
			});
		}

		throw new ActionError({
			code: 'FORBIDDEN',
			message: 'You do not have permission to permanently delete posts.',
		});
	}
}

function cleanupFailure(phase: CleanupPhase, postId: number, userId: string, error: unknown) {
	console.error(
		JSON.stringify({
			errorType: error instanceof Error ? error.name : 'UnknownError',
			event: 'post.deletion_cleanup_failed',
			phase,
			postId,
			userId,
		}),
	);

	return { completed: false as const, phase, postId };
}

export const postDeletionActions = {
	delete: defineAction({
		accept: 'form',
		input: deletePostInputSchema,
		handler: async (input, { cache, locals }) => {
			const author = authorizePostDeletion(locals);
			const owner = isOwner(author);
			const post = await stagePostDeletion(
				locals.database,
				author.id,
				input.postId,
				owner,
			);

			if (!post) {
				throw new ActionError({
					code: 'NOT_FOUND',
					message: 'This post is unavailable or you cannot manage it.',
				});
			}

			if (cache.enabled) {
				try {
					await cache.invalidate({ tags: postDeletionCacheTags(post) });
				} catch (error) {
					return cleanupFailure('cache', post.id, author.id, error);
				}
			}

			try {
				await deleteR2Objects(env.MEDIA_BUCKET, post.media.map((media) => media.objectKey));
			} catch (error) {
				return cleanupFailure('storage', post.id, author.id, error);
			}

			let finalizedPostId: number | null;
			try {
				finalizedPostId = await finalizePostDeletion(
					locals.database,
					author.id,
					post.id,
					owner,
				);
			} catch (error) {
				return cleanupFailure('database', post.id, author.id, error);
			}

			console.info(
				JSON.stringify({
					alreadyFinalized: finalizedPostId === null,
					event: 'post.deleted',
					ownerModeration: owner,
					postId: post.id,
					userId: author.id,
				}),
			);

			return { completed: true as const, phase: null, postId: post.id };
		},
	}),
};
