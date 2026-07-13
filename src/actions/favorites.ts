import { ActionError, defineAction } from 'astro:actions';

import { toggleFavorite } from '../db/favorite-mutations';
import { AuthorizationError, isOwner, requireCapability } from '../lib/authorization';
import { postInteractionCacheTags } from '../lib/cache-invalidation';
import { toggleFavoriteInputSchema } from '../lib/favorite';

function authorizeFavoriteToggle(locals: App.Locals) {
	try {
		return requireCapability(locals, 'favoritePosts');
	} catch (error) {
		if (!(error instanceof AuthorizationError)) {
			throw error;
		}

		if (error.code === 'AUTHENTICATION_REQUIRED') {
			throw new ActionError({ code: 'UNAUTHORIZED', message: 'Sign in to favorite posts.' });
		}

		if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
			throw new ActionError({
				code: 'FORBIDDEN',
				message: 'Change your temporary password before favoriting posts.',
			});
		}

		throw new ActionError({
			code: 'FORBIDDEN',
			message: 'You do not have permission to favorite posts.',
		});
	}
}

export const favoriteActions = {
	toggle: defineAction({
		accept: 'form',
		input: toggleFavoriteInputSchema,
		handler: async (input, { cache, locals }) => {
			const user = authorizeFavoriteToggle(locals);
			const result = await toggleFavorite(locals.database, user.id, input.postId, isOwner(user));

			if (!result.visible) {
				throw new ActionError({
					code: 'NOT_FOUND',
					message: 'This post is no longer available to favorite.',
				});
			}

			if (!result.changed) {
				throw new ActionError({
					code: 'CONFLICT',
					message: 'The favorite changed at the same time. Try again.',
				});
			}

			if (cache.enabled) {
				try {
					await cache.invalidate({ tags: postInteractionCacheTags(input.postId) });
				} catch (error) {
					console.error(
						JSON.stringify({
							errorType: error instanceof Error ? error.name : 'UnknownError',
							event: 'favorite.cache_purge_failed',
							postId: input.postId,
						}),
					);
				}
			}

			console.info(
				JSON.stringify({
					event: 'favorite.toggled',
					favorited: result.favorited,
					postId: input.postId,
					userId: user.id,
				}),
			);

			return { favorited: result.favorited, postId: input.postId };
		},
	}),
};
