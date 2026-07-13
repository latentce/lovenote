import { desc, eq, sql } from 'drizzle-orm';

import type { AuthenticatedUser } from '../lib/auth';
import type { Database } from './client';
import { user } from './auth-schema';
import { comments, posts } from './schema';
import { visiblePostFilter } from './post-queries';

export const COMMENT_MODERATION_LIMIT = 100;

export function buildModeratableCommentsQuery(
	database: Pick<Database, 'select'>,
	viewer: AuthenticatedUser,
	limit = COMMENT_MODERATION_LIMIT,
) {
	return database
		.select({
			authorUsername: sql<string>`coalesce(${user.displayUsername}, ${user.name})`,
			body: comments.body,
			createdAt: comments.createdAt,
			id: comments.id,
			postId: comments.postId,
			postStatus: posts.status,
			postVisibility: posts.visibility,
			status: comments.status,
		})
		.from(comments)
		.innerJoin(posts, eq(posts.id, comments.postId))
		.innerJoin(user, eq(user.id, comments.authorId))
		.where(visiblePostFilter(viewer))
		.orderBy(desc(comments.createdAt), desc(comments.id))
		.limit(limit);
}

export async function listModeratableComments(
	database: Database,
	viewer: AuthenticatedUser,
) {
	return buildModeratableCommentsQuery(database, viewer);
}

export type ModeratableComment = Awaited<ReturnType<typeof listModeratableComments>>[number];
