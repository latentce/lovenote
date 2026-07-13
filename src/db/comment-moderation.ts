import { sql } from 'drizzle-orm';

import type { Database } from './client';
import { visiblePostMutationFilter } from './mutation-filters';

export type CommentModerationResult = {
	changed: boolean;
	id: number;
	postId: number;
};

export async function setCommentStatus(
	database: Database,
	actorId: string,
	commentId: number,
	nextStatus: 'visible' | 'hidden',
	owner: boolean,
): Promise<CommentModerationResult | null> {
	const result = await database.execute<CommentModerationResult>(sql`
		with target_comment as materialized (
			select comments.id, comments.post_id, comments.status
			from comments
			inner join posts on posts.id = comments.post_id
			where comments.id = ${commentId}
				and ${visiblePostMutationFilter(actorId, owner)}
			for update of comments
		), changed_comment as (
			update comments
			set status = ${nextStatus}, updated_at = now()
			from target_comment
			where comments.id = target_comment.id
				and target_comment.status <> ${nextStatus}
			returning comments.id
		)
		select
			target_comment.id,
			target_comment.post_id as "postId",
			target_comment.status <> ${nextStatus} as changed
		from target_comment
	`);

	return result.rows[0] ?? null;
}

export async function deleteComment(
	database: Database,
	actorId: string,
	commentId: number,
	owner: boolean,
): Promise<CommentModerationResult | null> {
	const result = await database.execute<CommentModerationResult>(sql`
		with target_comment as materialized (
			select comments.id, comments.post_id
			from comments
			inner join posts on posts.id = comments.post_id
			where comments.id = ${commentId}
				and ${visiblePostMutationFilter(actorId, owner)}
			for update of comments
		), deleted_comment as (
			delete from comments
			using target_comment
			where comments.id = target_comment.id
			returning comments.id
		)
		select
			target_comment.id,
			target_comment.post_id as "postId",
			true as changed
		from target_comment
		inner join deleted_comment on deleted_comment.id = target_comment.id
	`);

	return result.rows[0] ?? null;
}

export async function canModeratePost(
	database: Database,
	actorId: string,
	postId: number,
	owner: boolean,
) {
	const result = await database.execute<{ id: number }>(sql`
		select posts.id
		from posts
		where posts.id = ${postId}
			and ${visiblePostMutationFilter(actorId, owner)}
	`);

	return result.rows[0]?.id === postId;
}
