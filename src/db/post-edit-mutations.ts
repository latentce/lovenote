import { sql } from 'drizzle-orm';

import type { EditPostInput, PostStatus, PostVisibility } from '../lib/post';
import type { Database } from './client';
import { requestedTagIdsQuery } from './tag-request';

export type PostEditResult = {
	changed: boolean;
	id: number;
	media: Array<{ id: string; previousRevision: number }>;
	previousVisibility: PostVisibility;
	status: Exclude<PostStatus, 'deleting'>;
	tagIds: number[];
	visibility: PostVisibility;
};

export async function updateOwnPost(
	database: Database,
	authorId: string,
	input: Pick<EditPostInput, 'body' | 'postId' | 'tagIds' | 'visibility'>,
): Promise<PostEditResult | null> {
	const requestedTagCount = input.tagIds.length;
	const requestedTags = requestedTagIdsQuery(input.tagIds);
	const result = await database.execute<PostEditResult>(sql`
		with requested_tags as (
			${requestedTags}
		), eligible_tags as materialized (
			select tags.id
			from tags
			inner join requested_tags on requested_tags.id = tags.id
		), eligible_tag_count as (
			select count(*)::integer as value
			from eligible_tags
		), target_post as materialized (
			select posts.id, posts.body, posts.status, posts.visibility
			from posts
			where posts.id = ${input.postId}
				and posts.author_id = ${authorId}
				and posts.status <> 'deleting'
			for update of posts
		), attachment_count as (
			select count(*)::integer as value
			from media_assets
			inner join target_post on target_post.id = media_assets.post_id
			where media_assets.upload_state = 'ready'
		), current_tags as materialized (
			select post_tags.tag_id
			from post_tags
			inner join target_post on target_post.id = post_tags.post_id
		), valid_target as (
			select target_post.*
			from target_post, attachment_count, eligible_tag_count
			where (
				char_length(regexp_replace(${input.body}, '[[:space:]]', '', 'g')) > 0
				or attachment_count.value > 0
			)
				and eligible_tag_count.value = ${requestedTagCount}
		), updated_post as (
			update posts
			set
				body = ${input.body},
				visibility = ${input.visibility},
				updated_at = now()
			from valid_target
			where posts.id = valid_target.id
			returning posts.id
		), removed_tags as (
			delete from post_tags
			using valid_target
			where post_tags.post_id = valid_target.id
				and not exists (
					select 1 from eligible_tags where eligible_tags.id = post_tags.tag_id
				)
			returning post_tags.tag_id
		), inserted_tags as (
			insert into post_tags (post_id, tag_id)
			select valid_target.id, eligible_tags.id
			from valid_target, eligible_tags
			on conflict (post_id, tag_id) do nothing
			returning post_tags.tag_id
		), rotated_media as (
			update media_assets
			set
				delivery_revision = media_assets.delivery_revision + 1,
				updated_at = now()
			from updated_post, valid_target
			where media_assets.post_id = updated_post.id
				and valid_target.visibility = 'public'
				and ${input.visibility} = 'private'
			returning
				media_assets.id,
				media_assets.delivery_revision - 1 as previous_revision
		), retry_media as (
			select
				media_assets.id,
				greatest(media_assets.delivery_revision - 1, 1) as previous_revision
			from media_assets
			inner join valid_target on valid_target.id = media_assets.post_id
			where valid_target.visibility = 'private'
				and ${input.visibility} = 'private'
		), media_to_purge as (
			select rotated_media.id, rotated_media.previous_revision
			from rotated_media
			union all
			select retry_media.id, retry_media.previous_revision
			from retry_media
		), affected_tags as (
			select current_tags.tag_id from current_tags
			union
			select eligible_tags.id from eligible_tags
		)
		select
			valid_target.id,
			(valid_target.body is distinct from ${input.body}
				or valid_target.visibility is distinct from ${input.visibility}
				or exists (select 1 from removed_tags)
				or exists (select 1 from inserted_tags)) as changed,
			valid_target.status,
			valid_target.visibility as "previousVisibility",
			${input.visibility}::post_visibility as visibility,
			coalesce(
				(
					select jsonb_agg(
						jsonb_build_object(
							'id', media_to_purge.id,
							'previousRevision', media_to_purge.previous_revision
						)
						order by media_to_purge.id
					)
					from media_to_purge
				),
				'[]'::jsonb
			) as media,
			coalesce(
				(select array_agg(affected_tags.tag_id order by affected_tags.tag_id) from affected_tags),
				'{}'::integer[]
			) as "tagIds"
		from valid_target
		where exists (select 1 from updated_post)
	`);

	return result.rows[0] ?? null;
}
