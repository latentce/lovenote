import { sql } from 'drizzle-orm';

import type { Database } from './client';
import { visiblePostMutationFilter } from './mutation-filters';

export type FavoriteToggleResult = {
	changed: boolean;
	favorited: boolean;
	visible: boolean;
};

export async function toggleFavorite(
	database: Database,
	userId: string,
	postId: number,
	owner: boolean,
): Promise<FavoriteToggleResult> {
	const result = await database.execute<FavoriteToggleResult>(sql`
		with target_post as (
			select posts.id
			from posts
			where posts.id = ${postId}
				and ${visiblePostMutationFilter(userId, owner)}
		), deleted_favorite as (
			delete from favorites
			using target_post
			where favorites.user_id = ${userId}
				and favorites.post_id = target_post.id
			returning favorites.post_id
		), inserted_favorite as (
			insert into favorites (user_id, post_id)
			select ${userId}, target_post.id
			from target_post
			where not exists (select 1 from deleted_favorite)
			on conflict (user_id, post_id) do nothing
			returning post_id
		)
		select
			exists(select 1 from target_post) as visible,
			exists(select 1 from inserted_favorite) as favorited,
			(
				exists(select 1 from deleted_favorite)
				or exists(select 1 from inserted_favorite)
			) as changed
	`);

	return result.rows[0] ?? { changed: false, favorited: false, visible: false };
}

export async function isPostFavorited(database: Database, userId: string, postId: number) {
	const result = await database.execute<{ favorited: boolean }>(sql`
		select exists(
			select 1
			from favorites
			where favorites.user_id = ${userId}
				and favorites.post_id = ${postId}
		) as favorited
	`);

	return result.rows[0]?.favorited ?? false;
}
