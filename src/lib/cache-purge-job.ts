import type { Database } from '../db/client';
import { recordCachePurgeJob, type RecordCachePurgeJobInput } from '../db/cache-purge-jobs';

export function errorType(error: unknown) {
	return error instanceof Error ? error.name : 'UnknownError';
}

export async function preserveFailedPrivacyPurge(
	database: Database,
	input: Omit<RecordCachePurgeJobInput, 'errorType'>,
	error: unknown,
) {
	try {
		return await recordCachePurgeJob(database, { ...input, errorType: errorType(error) });
	} catch (persistenceError) {
		console.error(
			JSON.stringify({
				errorType: errorType(persistenceError),
				event: 'cache_purge.persistence_failed',
				operation: input.operation,
				postId: input.postId,
			}),
		);
		return null;
	}
}
