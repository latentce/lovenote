import { sql } from 'drizzle-orm';

import type { CreateCommentInput } from '../lib/comment';
import type { Database } from './client';
import { visiblePostMutationFilter } from './mutation-filters';

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
				and ${visiblePostMutationFilter(authorId, owner)}
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
