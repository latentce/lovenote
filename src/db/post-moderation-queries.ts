import { desc, eq, sql } from 'drizzle-orm';

import { user } from './auth-schema';
import type { Database } from './client';
import { mediaAssets, posts } from './schema';

export const MODERATABLE_POST_LIMIT = 100;

export function buildModeratablePostsQuery(
	database: Pick<Database, 'select'>,
	limit = MODERATABLE_POST_LIMIT,
) {
	return database
		.select({
			attachmentCount: sql<number>`(
				select count(*)::integer
				from ${mediaAssets}
				where ${mediaAssets.postId} = ${posts.id}
					and ${mediaAssets.uploadState} = 'ready'
			)`,
			authorId: posts.authorId,
			authorUsername: sql<string>`coalesce(${user.displayUsername}, ${user.name})`,
			body: posts.body,
			createdAt: posts.createdAt,
			id: posts.id,
			status: posts.status,
			updatedAt: posts.updatedAt,
			visibility: posts.visibility,
		})
		.from(posts)
		.innerJoin(user, eq(user.id, posts.authorId))
		.orderBy(desc(posts.createdAt), desc(posts.id))
		.limit(limit);
}

export async function listModeratablePosts(database: Database) {
	return buildModeratablePostsQuery(database);
}

export type ModeratablePost = Awaited<ReturnType<typeof listModeratablePosts>>[number];
