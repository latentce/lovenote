import { sql } from 'drizzle-orm';

import type { CreatePostInput, PostStatus } from '../lib/post';
import type { Database } from './client';

export type PostLifecycleResult = {
	changed: boolean;
	id: number;
	media: Array<{ id: string; previousRevision: number }>;
	tagIds: number[];
	visibility: 'public' | 'private';
};

function requestedAssetsQuery(attachmentIds: string[]) {
	if (attachmentIds.length === 0) {
		return sql`
			select null::uuid as id, null::integer as attachment_order
			where false
		`;
	}

	const ids = sql.join(
		attachmentIds.map((id) => sql`${id}::uuid`),
		sql`, `,
	);

	return sql`
		select requested.id, requested.ordinality::integer - 1 as attachment_order
		from unnest(array[${ids}]) with ordinality as requested(id, ordinality)
	`;
}

export async function createPost(database: Database, authorId: string, input: CreatePostInput) {
	const attachmentCount = input.attachmentIds.length;
	const requestedAssets = requestedAssetsQuery(input.attachmentIds);

	// Locking eligible assets makes concurrent attempts to attach the same upload serialize.
	// The post, its validation, and all attachment updates remain one atomic statement.
	const result = await database.execute<{ id: number }>(sql`
		with requested_assets as (
			${requestedAssets}
		), eligible_assets as materialized (
			select media_assets.id, requested_assets.attachment_order
			from media_assets
			inner join requested_assets on requested_assets.id = media_assets.id
			where media_assets.uploader_id = ${authorId}
				and media_assets.post_id is null
				and media_assets.upload_state = 'ready'
				and media_assets.expires_at > now()
			for update of media_assets
		), eligible_count as (
			select count(*)::integer as value
			from eligible_assets
		), created_post as (
			insert into posts (author_id, body, visibility)
			select ${authorId}, ${input.body}, ${input.visibility}
			from eligible_count
			where eligible_count.value = ${attachmentCount}
			returning id
		), attached_assets as (
			update media_assets
			set
				post_id = created_post.id,
				attachment_order = eligible_assets.attachment_order,
				expires_at = null,
				updated_at = now()
			from eligible_assets, created_post
			where media_assets.id = eligible_assets.id
			returning media_assets.id
		)
		select created_post.id
		from created_post
		where (select count(*)::integer from attached_assets) = ${attachmentCount}
	`);

	return result.rows[0]?.id ?? null;
}

export async function setOwnPostStatus(
	database: Database,
	authorId: string,
	postId: number,
	nextStatus: Extract<PostStatus, 'active' | 'hidden'>,
): Promise<PostLifecycleResult | null> {
	const previousStatus = nextStatus === 'hidden' ? 'active' : 'hidden';
	const result = await database.execute<PostLifecycleResult>(sql`
		with target_post as materialized (
			select posts.id, posts.status, posts.visibility
			from posts
			where posts.id = ${postId}
				and posts.author_id = ${authorId}
				and posts.status in (${previousStatus}, ${nextStatus})
			for update of posts
		), changed_post as (
			update posts
			set status = ${nextStatus}, updated_at = now()
			from target_post
			where posts.id = target_post.id
				and target_post.status = ${previousStatus}
			returning posts.id
		), rotated_media as (
			update media_assets
			set
				delivery_revision = media_assets.delivery_revision + 1,
				updated_at = now()
			from changed_post
			where media_assets.post_id = changed_post.id
				and ${nextStatus} = 'hidden'
			returning
				media_assets.id,
				media_assets.delivery_revision - 1 as previous_revision
		), media_to_purge as (
			select rotated_media.id, rotated_media.previous_revision
			from rotated_media
			union all
			select media_assets.id, greatest(media_assets.delivery_revision - 1, 1)
			from media_assets
			inner join target_post on target_post.id = media_assets.post_id
			where target_post.status = 'hidden'
				and ${nextStatus} = 'hidden'
		), affected_tags as (
			select post_tags.tag_id
			from post_tags
			inner join target_post on target_post.id = post_tags.post_id
		)
		select
			target_post.id,
			target_post.status = ${previousStatus} as changed,
			target_post.visibility,
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
			) as tag_ids
		from target_post
	`);

	return result.rows[0] ?? null;
}
