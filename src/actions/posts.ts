import { ActionError, defineAction } from 'astro:actions';

import { createPost } from '../db/post-mutations';
import { AuthorizationError, requireCapability } from '../lib/authorization';
import { createPostInputSchema } from '../lib/post';

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
};
