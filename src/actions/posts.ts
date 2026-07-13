import { ActionError, defineAction } from 'astro:actions';

import { updateOwnPost } from '../db/post-edit-mutations';
import { createPost } from '../db/post-mutations';
import { AuthorizationError, requireCapability } from '../lib/authorization';
import { postEditCacheTags } from '../lib/cache-invalidation';
import { createPostInputSchema, editPostInputSchema } from '../lib/post';

function authorizePostCreation(locals: App.Locals) {
	try {
		return requireCapability(locals, 'createPosts');
	} catch (error) {
		if (!(error instanceof AuthorizationError)) {
			throw error;
		}

		if (error.code === 'AUTHENTICATION_REQUIRED') {
			throw new ActionError({
				code: 'UNAUTHORIZED',
				message: 'Sign in to create a post.',
			});
		}

		if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
			throw new ActionError({
				code: 'FORBIDDEN',
				message: 'Change your temporary password before creating posts.',
			});
		}

		throw new ActionError({
			code: 'FORBIDDEN',
			message: 'You do not have permission to create posts.',
		});
	}
}

function authorizePostEditing(locals: App.Locals) {
	try {
		return requireCapability(locals, 'editOwnPosts');
	} catch (error) {
		if (!(error instanceof AuthorizationError)) throw error;

		if (error.code === 'AUTHENTICATION_REQUIRED') {
			throw new ActionError({ code: 'UNAUTHORIZED', message: 'Sign in to edit posts.' });
		}

		if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
			throw new ActionError({
				code: 'FORBIDDEN',
				message: 'Change your temporary password before editing posts.',
			});
		}

		throw new ActionError({
			code: 'FORBIDDEN',
			message: 'You do not have permission to edit your posts.',
		});
	}
}

export const postActions = {
	create: defineAction({
		accept: 'form',
		input: createPostInputSchema,
		handler: async (input, { locals }) => {
			const author = authorizePostCreation(locals);
			const postId = await createPost(locals.database, author.id, input);

			if (!postId) {
				console.warn(
					JSON.stringify({
						event: 'post.create_attachments_rejected',
						attachmentCount: input.attachmentIds.length,
						userId: author.id,
					}),
				);
				throw new ActionError({
					code: 'CONFLICT',
					message: 'One or more attachments are no longer available. Remove them and try again.',
				});
			}

			console.info(
				JSON.stringify({
					event: 'post.created',
					attachmentCount: input.attachmentIds.length,
					postId,
					userId: author.id,
					visibility: input.visibility,
				}),
			);

			return { postId };
		},
	}),
	update: defineAction({
		accept: 'form',
		input: editPostInputSchema,
		handler: async (input, { cache, locals }) => {
			const author = authorizePostEditing(locals);
			const post = await updateOwnPost(locals.database, author.id, input);

			if (!post) {
				throw new ActionError({
					code: 'CONFLICT',
					message: 'This post is unavailable, does not belong to you, or cannot be empty without an attachment.',
				});
			}

			let cachePurged = true;
			const purgePublic = input.purgePublic ||
				post.previousVisibility === 'public' || post.visibility === 'public';
			if (cache.enabled) {
				try {
					await cache.invalidate({ tags: postEditCacheTags(post, purgePublic) });
				} catch (error) {
					cachePurged = false;
					console.error(
						JSON.stringify({
							errorType: error instanceof Error ? error.name : 'UnknownError',
							event: 'post.edit_cache_purge_failed',
							postId: post.id,
						}),
					);
				}
			}

			console.info(
				JSON.stringify({
					cachePurged,
					changed: post.changed,
					event: 'post.edited',
					postId: post.id,
					userId: author.id,
					visibility: post.visibility,
				}),
			);

			return { cachePurged, changed: post.changed, postId: post.id, purgePublic };
		},
	}),
};
