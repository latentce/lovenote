import { ActionError, defineAction } from 'astro:actions';

import {
	createTag,
	findTagPurgeContext,
	mergeTags,
	type TagMergeResult,
	type TagMutationResult,
	updateTag,
} from '../db/tag-admin';
import { AuthorizationError, requireCapability } from '../lib/authorization';
import {
	createTagInputSchema,
	mergeTagInputSchema,
	retryTagPurgeInputSchema,
	updateTagInputSchema,
} from '../lib/tag';

interface ActionCache {
	enabled: boolean;
	invalidate(options: { tags: string[] }): Promise<void>;
}

function authorizeTagManagement(locals: App.Locals) {
	try {
		return requireCapability(locals, 'manageTags');
	} catch (error) {
		if (!(error instanceof AuthorizationError)) throw error;

		if (error.code === 'AUTHENTICATION_REQUIRED') {
			throw new ActionError({ code: 'UNAUTHORIZED', message: 'Sign in to manage tags.' });
		}
		if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
			throw new ActionError({
				code: 'FORBIDDEN',
				message: 'Change your temporary password before managing tags.',
			});
		}

		throw new ActionError({
			code: 'FORBIDDEN',
			message: 'You do not have permission to manage tags.',
		});
	}
}

function postgresErrorCode(error: unknown): string | null {
	if (typeof error !== 'object' || error === null) return null;
	if ('code' in error && typeof error.code === 'string') return error.code;
	if ('cause' in error) return postgresErrorCode(error.cause);
	return null;
}

function cacheTagsForMutation(
	result: TagMutationResult | TagMergeResult,
	staleTagId?: number,
) {
	const tagIds = 'targetTagId' in result
		? [result.sourceTagId, result.targetTagId]
		: [result.tagId];
	if (staleTagId) tagIds.push(staleTagId);

	return [
		'tags',
		...[...new Set(tagIds)].map((tagId) => `tag:${tagId}`),
		...result.publicPostIds.map((postId) => `post:${postId}`),
	];
}

async function purgeTagMutation(
	cache: ActionCache,
	result: TagMutationResult | TagMergeResult,
) {
	if (!cache.enabled) return true;

	try {
		await cache.invalidate({ tags: cacheTagsForMutation(result) });
		return true;
	} catch (error) {
		console.error(
			JSON.stringify({
				errorType: error instanceof Error ? error.name : 'UnknownError',
				event: 'tag.cache_purge_failed',
				tagIds: 'targetTagId' in result
					? [result.sourceTagId, result.targetTagId]
					: [result.tagId],
			}),
		);
		return false;
	}
}

function mutationFailure(error: unknown): never {
	if (postgresErrorCode(error) === '23505') {
		throw new ActionError({
			code: 'CONFLICT',
			message: 'That tag slug is already in use.',
		});
	}

	throw new ActionError({
		code: 'INTERNAL_SERVER_ERROR',
		message: 'The tag change could not be saved. Please try again.',
	});
}

export const tagActions = {
	create: defineAction({
		accept: 'form',
		input: createTagInputSchema,
		handler: async (input, { cache, locals }) => {
			const manager = authorizeTagManagement(locals);
			let tag: TagMutationResult | null;
			try {
				tag = await createTag(locals.database, input);
			} catch (error) {
				mutationFailure(error);
			}
			if (!tag) mutationFailure(null);

			const cachePurged = await purgeTagMutation(cache, tag);
			console.info(
				JSON.stringify({
					cachePurged,
					event: 'tag.created',
					tagId: tag.tagId,
					userId: manager.id,
				}),
			);
			return { cachePurged, operation: 'created' as const, ...tag };
		},
	}),
	update: defineAction({
		accept: 'form',
		input: updateTagInputSchema,
		handler: async (input, { cache, locals }) => {
			const manager = authorizeTagManagement(locals);
			let tag: TagMutationResult | null;
			try {
				tag = await updateTag(locals.database, input);
			} catch (error) {
				mutationFailure(error);
			}
			if (!tag) {
				throw new ActionError({ code: 'NOT_FOUND', message: 'This tag no longer exists.' });
			}

			const cachePurged = await purgeTagMutation(cache, tag);
			console.info(
				JSON.stringify({
					cachePurged,
					changed: tag.changed,
					event: 'tag.updated',
					tagId: tag.tagId,
					userId: manager.id,
				}),
			);
			return { cachePurged, operation: 'updated' as const, ...tag };
		},
	}),
	merge: defineAction({
		accept: 'form',
		input: mergeTagInputSchema,
		handler: async (input, { cache, locals }) => {
			const manager = authorizeTagManagement(locals);
			let merged: TagMergeResult | null;
			try {
				merged = await mergeTags(locals.database, input);
			} catch (error) {
				mutationFailure(error);
			}
			if (!merged) {
				throw new ActionError({
					code: 'NOT_FOUND',
					message: 'One or both tags no longer exist.',
				});
			}

			const cachePurged = await purgeTagMutation(cache, merged);
			console.info(
				JSON.stringify({
					cachePurged,
					event: 'tag.merged',
					sourceTagId: merged.sourceTagId,
					targetTagId: merged.targetTagId,
					userId: manager.id,
				}),
			);
			return { cachePurged, operation: 'merged' as const, ...merged };
		},
	}),
	retryPurge: defineAction({
		accept: 'form',
		input: retryTagPurgeInputSchema,
		handler: async (input, { cache, locals }) => {
			const manager = authorizeTagManagement(locals);
			const context = await findTagPurgeContext(locals.database, input.tagId);
			if (!context) {
				throw new ActionError({ code: 'NOT_FOUND', message: 'This tag no longer exists.' });
			}

			if (cache.enabled) {
				try {
					await cache.invalidate({
						tags: cacheTagsForMutation(
							{ changed: false, publicPostIds: context.publicPostIds, slug: '', tagId: context.tagId },
							input.staleTagId,
						),
					});
				} catch (error) {
					console.error(
						JSON.stringify({
							errorType: error instanceof Error ? error.name : 'UnknownError',
							event: 'tag.cache_purge_retry_failed',
							tagId: context.tagId,
						}),
					);
					return { cachePurged: false, operation: 'purged' as const, tagId: context.tagId };
				}
			}

			console.info(
				JSON.stringify({
					event: 'tag.cache_purge_retried',
					tagId: context.tagId,
					userId: manager.id,
				}),
			);
			return { cachePurged: true, operation: 'purged' as const, tagId: context.tagId };
		},
	}),
};
