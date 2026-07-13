import { sql } from 'drizzle-orm';

import type { CreatePostInput } from '../lib/post';
import type { Database } from './client';

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
