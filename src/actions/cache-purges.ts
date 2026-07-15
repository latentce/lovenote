import { ActionError, defineAction } from 'astro:actions';

import {
	completeCachePurgeJob,
	findCachePurgeJob,
	markCachePurgeJobFailed,
} from '../db/cache-purge-jobs';
import { AuthorizationError, requireOwner } from '../lib/authorization';
import { errorType } from '../lib/cache-purge-job';
import { retryCachePurgeInputSchema } from '../lib/cache-purge';

function authorizeCacheRecovery(locals: App.Locals) {
	try {
		return requireOwner(locals);
	} catch (error) {
		if (!(error instanceof AuthorizationError)) throw error;
		throw new ActionError({
			code: error.code === 'AUTHENTICATION_REQUIRED' ? 'UNAUTHORIZED' : 'FORBIDDEN',
			message: 'Only the owner can retry cache purges.',
		});
	}
}

export const cachePurgeActions = {
	retry: defineAction({
		accept: 'form',
		input: retryCachePurgeInputSchema,
		handler: async (input, { cache, locals }) => {
			const owner = authorizeCacheRecovery(locals);
			const job = await findCachePurgeJob(locals.database, input.jobId);
			if (!job) {
				throw new ActionError({ code: 'NOT_FOUND', message: 'This cache purge is no longer pending.' });
			}
			if (!cache.enabled) {
				throw new ActionError({
					code: 'SERVICE_UNAVAILABLE',
					message: 'Shared cache invalidation is unavailable in this runtime.',
				});
			}

			try {
				await cache.invalidate({ tags: job.tags });
			} catch (error) {
				await markCachePurgeJobFailed(locals.database, job.id, errorType(error));
				console.error(JSON.stringify({
					errorType: errorType(error),
					event: 'cache_purge.retry_failed',
					jobId: job.id,
					postId: job.postId,
					userId: owner.id,
				}));
				return { completed: false as const, jobId: job.id };
			}

			await completeCachePurgeJob(locals.database, job.id);
			console.info(JSON.stringify({
				event: 'cache_purge.recovered',
				jobId: job.id,
				postId: job.postId,
				userId: owner.id,
			}));
			return { completed: true as const, jobId: job.id };
		},
	}),
};
