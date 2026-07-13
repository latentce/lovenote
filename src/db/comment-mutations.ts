import { sql } from 'drizzle-orm';

import type { CreateCommentInput } from '../lib/comment';
import type { Database } from './client';

function visibleTargetFilter(authorId: string, owner: boolean) {
	if (owner) {
		return sql`posts.status <> 'deleting'`;
	}

	return sql`(
		posts.status = 'active'
		or (posts.status = 'hidden' and posts.author_id = ${authorId})
	)`;
}

export async function createComment(
	database: Database,
	authorId: string,
	input: CreateCommentInput,
	owner: boolean,
) {
	const result = await database.execute<{ id: number }>(sql`
		with target_post as (
			select posts.id
			from posts
			where posts.id = ${input.postId}
				and ${visibleTargetFilter(authorId, owner)}
		), inserted_comment as (
			insert into comments (post_id, author_id, body)
			select target_post.id, ${authorId}, ${input.body}
			from target_post
			returning id
		)
		select id from inserted_comment
	`);

	return result.rows[0]?.id ?? null;
}
