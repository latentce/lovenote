import { sql } from 'drizzle-orm';

import type { PostStatus } from '../lib/post';
import type { Database } from './client';
import { manageablePostAuthorFilter } from './mutation-filters';

export type StagedPostDeletion = {
	changed: boolean;
	id: number;
	media: Array<{
		id: string;
		objectKey: string;
		previousRevision: number;
	}>;
	previousStatus: PostStatus;
	tagIds: number[];
	visibility: 'public' | 'private';
};

export async function stagePostDeletion(
	database: Database,
	actorId: string,
	postId: number,
	owner: boolean,
): Promise<StagedPostDeletion | null> {
	const result = await database.execute<StagedPostDeletion>(sql`
		with target_post as materialized (
			select posts.id, posts.status, posts.visibility
			from posts
			where posts.id = ${postId}
				and ${manageablePostAuthorFilter(actorId, owner)}
				and posts.status in ('active', 'hidden', 'deleting')
			for update of posts
		), changed_post as (
			update posts
			set status = 'deleting', updated_at = now()
			from target_post
			where posts.id = target_post.id
				and target_post.status <> 'deleting'
			returning posts.id
		), rotated_media as (
			update media_assets
			set
				delivery_revision = media_assets.delivery_revision + 1,
				updated_at = now()
			from changed_post
			where media_assets.post_id = changed_post.id
			returning
				media_assets.id,
				media_assets.object_key,
				media_assets.delivery_revision - 1 as previous_revision
		), retry_media as (
			select
				media_assets.id,
				media_assets.object_key,
				greatest(media_assets.delivery_revision - 1, 1) as previous_revision
			from media_assets
			inner join target_post on target_post.id = media_assets.post_id
			where target_post.status = 'deleting'
		), media_to_delete as (
			select rotated_media.id, rotated_media.object_key, rotated_media.previous_revision
			from rotated_media
			union all
			select retry_media.id, retry_media.object_key, retry_media.previous_revision
			from retry_media
		), affected_tags as (
			select post_tags.tag_id
			from post_tags
			inner join target_post on target_post.id = post_tags.post_id
		)
		select
			target_post.id,
			target_post.status <> 'deleting' as changed,
			target_post.status as "previousStatus",
			target_post.visibility,
			coalesce(
				(
					select jsonb_agg(
						jsonb_build_object(
							'id', media_to_delete.id,
							'objectKey', media_to_delete.object_key,
							'previousRevision', media_to_delete.previous_revision
						)
						order by media_to_delete.id
					)
					from media_to_delete
				),
				'[]'::jsonb
			) as media,
			coalesce(
				(select array_agg(affected_tags.tag_id order by affected_tags.tag_id) from affected_tags),
				'{}'::integer[]
			) as "tagIds"
		from target_post
	`);

	return result.rows[0] ?? null;
}

export function stageOwnPostDeletion(database: Database, authorId: string, postId: number) {
	return stagePostDeletion(database, authorId, postId, false);
}

export async function finalizePostDeletion(
	database: Database,
	actorId: string,
	postId: number,
	owner: boolean,
) {
	const result = await database.execute<{ id: number }>(sql`
		delete from posts
		where posts.id = ${postId}
			and ${manageablePostAuthorFilter(actorId, owner)}
			and posts.status = 'deleting'
		returning posts.id
	`);

	return result.rows[0]?.id ?? null;
}

export function finalizeOwnPostDeletion(database: Database, authorId: string, postId: number) {
	return finalizePostDeletion(database, authorId, postId, false);
}
