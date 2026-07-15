import { asc, eq, sql } from 'drizzle-orm';

import type { Database } from './client';
import { cachePurgeJobs } from './schema';

export interface RecordCachePurgeJobInput {
	errorType: string;
	operation: 'post-edit-access-reduction' | 'post-hide-access-reduction';
	postId: number;
	tags: string[];
}

export async function recordCachePurgeJob(database: Database, input: RecordCachePurgeJobInput) {
	const [job] = await database
		.insert(cachePurgeJobs)
		.values({
			lastErrorType: input.errorType.slice(0, 128),
			operation: input.operation,
			postId: input.postId,
			tags: [...new Set(input.tags)],
		})
		.returning({ id: cachePurgeJobs.id });

	return job?.id ?? null;
}

export function listCachePurgeJobs(database: Database, limit = 100) {
	return database.query.cachePurgeJobs.findMany({
		limit,
		orderBy: [asc(cachePurgeJobs.createdAt), asc(cachePurgeJobs.id)],
	});
}

export function findCachePurgeJob(database: Database, jobId: number) {
	return database.query.cachePurgeJobs.findFirst({ where: eq(cachePurgeJobs.id, jobId) });
}

export async function markCachePurgeJobFailed(database: Database, jobId: number, errorType: string) {
	const [job] = await database
		.update(cachePurgeJobs)
		.set({
			attemptCount: sql`${cachePurgeJobs.attemptCount} + 1`,
			lastAttemptAt: new Date(),
			lastErrorType: errorType.slice(0, 128),
			updatedAt: new Date(),
		})
		.where(eq(cachePurgeJobs.id, jobId))
		.returning({ id: cachePurgeJobs.id });

	return job?.id ?? null;
}

export async function completeCachePurgeJob(database: Database, jobId: number) {
	const [job] = await database
		.delete(cachePurgeJobs)
		.where(eq(cachePurgeJobs.id, jobId))
		.returning({ id: cachePurgeJobs.id });

	return job?.id ?? null;
}
