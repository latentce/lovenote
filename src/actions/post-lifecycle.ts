import { ActionError, defineAction } from 'astro:actions';

import { setOwnPostStatus } from '../db/post-mutations';
import { AuthorizationError, requireCapability } from '../lib/authorization';
import { postLifecycleCacheTags } from '../lib/cache-invalidation';
import {
	postLifecycleInputSchema,
	type PostLifecycleInput,
	type PostStatus,
} from '../lib/post';

interface ActionCache {
	enabled: boolean;
	invalidate(options: { tags: string[] }): Promise<void>;
}

function authorizePostLifecycle(locals: App.Locals) {
	try {
		return requireCapability(locals, 'hideOwnPosts');
	} catch (error) {
		if (!(error instanceof AuthorizationError)) throw error;

		if (error.code === 'AUTHENTICATION_REQUIRED') {
			throw new ActionError({ code: 'UNAUTHORIZED', message: 'Sign in to manage posts.' });
		}

		if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
			throw new ActionError({
				code: 'FORBIDDEN',
				message: 'Change your temporary password before managing posts.',
			});
		}

		throw new ActionError({
			code: 'FORBIDDEN',
			message: 'You do not have permission to hide or restore posts.',
		});
	}
}

async function changePostStatus(
	input: PostLifecycleInput,
	locals: App.Locals,
	cache: ActionCache,
	nextStatus: Extract<PostStatus, 'active' | 'hidden'>,
) {
	const author = authorizePostLifecycle(locals);
	const post = await setOwnPostStatus(locals.database, author.id, input.postId, nextStatus);

	if (!post) {
		throw new ActionError({
			code: 'NOT_FOUND',
			message: 'This post is unavailable or does not belong to you.',
		});
	}

	let cachePurged = true;
	if (cache.enabled) {
		try {
			await cache.invalidate({ tags: postLifecycleCacheTags(post, nextStatus) });
		} catch (error) {
			cachePurged = false;
			console.error(
				JSON.stringify({
					errorType: error instanceof Error ? error.name : 'UnknownError',
					event: 'post.lifecycle_cache_purge_failed',
					postId: post.id,
					status: nextStatus,
				}),
			);
		}
	}

	console.info(
		JSON.stringify({
			cachePurged,
			event: `post.${nextStatus}`,
			postId: post.id,
			userId: author.id,
		}),
	);

	return { cachePurged, changed: post.changed, postId: post.id, status: nextStatus };
}

export const postLifecycleActions = {
	hide: defineAction({
		accept: 'form',
		input: postLifecycleInputSchema,
		handler: (input, { cache, locals }) => changePostStatus(input, locals, cache, 'hidden'),
	}),
	restore: defineAction({
		accept: 'form',
		input: postLifecycleInputSchema,
		handler: (input, { cache, locals }) => changePostStatus(input, locals, cache, 'active'),
	}),
};
