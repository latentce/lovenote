import { ActionError, defineAction } from 'astro:actions';

import {
	canModeratePost,
	deleteComment,
	setCommentStatus,
} from '../db/comment-moderation';
import { createComment } from '../db/comment-mutations';
import { AuthorizationError, isOwner, requireCapability } from '../lib/authorization';
import { postInteractionCacheTags } from '../lib/cache-invalidation';
import {
	createCommentInputSchema,
	deleteCommentInputSchema,
	moderateCommentInputSchema,
	retryCommentPurgeInputSchema,
} from '../lib/comment';

interface ActionCache {
	enabled: boolean;
	invalidate(options: { tags: string[] }): Promise<void>;
}

function authorizeCommentCreation(locals: App.Locals) {
	try {
		return requireCapability(locals, 'createComments');
	} catch (error) {
		if (!(error instanceof AuthorizationError)) {
			throw error;
		}

		if (error.code === 'AUTHENTICATION_REQUIRED') {
			throw new ActionError({ code: 'UNAUTHORIZED', message: 'Sign in to comment.' });
		}

		if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
			throw new ActionError({
				code: 'FORBIDDEN',
				message: 'Change your temporary password before commenting.',
			});
		}

		throw new ActionError({
			code: 'FORBIDDEN',
			message: 'You do not have permission to create comments.',
		});
	}
}

function authorizeCommentModeration(locals: App.Locals) {
	try {
		return requireCapability(locals, 'moderateComments');
	} catch (error) {
		if (!(error instanceof AuthorizationError)) throw error;

		if (error.code === 'AUTHENTICATION_REQUIRED') {
			throw new ActionError({ code: 'UNAUTHORIZED', message: 'Sign in to moderate comments.' });
		}

		if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
			throw new ActionError({
				code: 'FORBIDDEN',
				message: 'Change your temporary password before moderating comments.',
			});
		}

		throw new ActionError({
			code: 'FORBIDDEN',
			message: 'You do not have permission to moderate comments.',
		});
	}
}

async function purgeCommentPost(cache: ActionCache, postId: number, operation: string) {
	if (!cache.enabled) return true;

	try {
		await cache.invalidate({ tags: postInteractionCacheTags(postId) });
		return true;
	} catch (error) {
		console.error(
			JSON.stringify({
				errorType: error instanceof Error ? error.name : 'UnknownError',
				event: 'comment.moderation_cache_purge_failed',
				operation,
				postId,
			}),
		);
		return false;
	}
}

async function changeCommentStatus(
	commentId: number,
	nextStatus: 'visible' | 'hidden',
	locals: App.Locals,
	cache: ActionCache,
) {
	const moderator = authorizeCommentModeration(locals);
	const operation = nextStatus === 'hidden' ? 'hidden' : 'restored';
	const comment = await setCommentStatus(
		locals.database,
		moderator.id,
		commentId,
		nextStatus,
		isOwner(moderator),
	);

	if (!comment) {
		throw new ActionError({
			code: 'NOT_FOUND',
			message: 'This comment is no longer available to moderate.',
		});
	}

	const cachePurged = await purgeCommentPost(cache, comment.postId, operation);
	console.info(
		JSON.stringify({
			cachePurged,
			changed: comment.changed,
			commentId: comment.id,
			event: `comment.${nextStatus}`,
			postId: comment.postId,
			userId: moderator.id,
		}),
	);

	return {
		cachePurged,
		changed: comment.changed,
		commentId: comment.id,
		operation,
		postId: comment.postId,
	};
}

export const commentActions = {
	create: defineAction({
		accept: 'form',
		input: createCommentInputSchema,
		handler: async (input, { cache, locals }) => {
			const author = authorizeCommentCreation(locals);
			const commentId = await createComment(locals.database, author.id, input, isOwner(author));

			if (!commentId) {
				throw new ActionError({
					code: 'NOT_FOUND',
					message: 'This post is no longer available to comment on.',
				});
			}

			if (cache.enabled) {
				try {
					await cache.invalidate({ tags: postInteractionCacheTags(input.postId) });
				} catch (error) {
					console.error(
						JSON.stringify({
							commentId,
							errorType: error instanceof Error ? error.name : 'UnknownError',
							event: 'comment.cache_purge_failed',
							postId: input.postId,
						}),
					);
				}
			}

			console.info(
				JSON.stringify({
					commentId,
					event: 'comment.created',
					postId: input.postId,
					userId: author.id,
				}),
			);

			return { commentId, postId: input.postId };
		},
	}),
	hide: defineAction({
		accept: 'form',
		input: moderateCommentInputSchema,
		handler: (input, { cache, locals }) =>
			changeCommentStatus(input.commentId, 'hidden', locals, cache),
	}),
	restore: defineAction({
		accept: 'form',
		input: moderateCommentInputSchema,
		handler: (input, { cache, locals }) =>
			changeCommentStatus(input.commentId, 'visible', locals, cache),
	}),
	delete: defineAction({
		accept: 'form',
		input: deleteCommentInputSchema,
		handler: async (input, { cache, locals }) => {
			const moderator = authorizeCommentModeration(locals);
			const comment = await deleteComment(
				locals.database,
				moderator.id,
				input.commentId,
				isOwner(moderator),
			);

			if (!comment) {
				throw new ActionError({
					code: 'NOT_FOUND',
					message: 'This comment is no longer available to moderate.',
				});
			}

			const cachePurged = await purgeCommentPost(cache, comment.postId, 'deleted');
			console.info(
				JSON.stringify({
					cachePurged,
					commentId: comment.id,
					event: 'comment.deleted',
					postId: comment.postId,
					userId: moderator.id,
				}),
			);

			return {
				cachePurged,
				changed: true,
				commentId: comment.id,
				operation: 'deleted' as const,
				postId: comment.postId,
			};
		},
	}),
	retryPurge: defineAction({
		accept: 'form',
		input: retryCommentPurgeInputSchema,
		handler: async (input, { cache, locals }) => {
			const moderator = authorizeCommentModeration(locals);
			const allowed = await canModeratePost(
				locals.database,
				moderator.id,
				input.postId,
				isOwner(moderator),
			);

			if (!allowed) {
				throw new ActionError({
					code: 'NOT_FOUND',
					message: 'This post is no longer available to moderate.',
				});
			}

			const cachePurged = await purgeCommentPost(cache, input.postId, 'retry');
			return {
				cachePurged,
				changed: false,
				commentId: null,
				operation: 'purged' as const,
				postId: input.postId,
			};
		},
	}),
};
