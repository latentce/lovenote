import { ActionError, defineAction } from 'astro:actions';

import { createComment } from '../db/comment-mutations';
import { AuthorizationError, isOwner, requireCapability } from '../lib/authorization';
import { createCommentInputSchema } from '../lib/comment';

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
					await cache.invalidate({ tags: [`post:${input.postId}`] });
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
};
