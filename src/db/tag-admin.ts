import { asc, count, eq, sql } from 'drizzle-orm';

import type { CreateTagInput, MergeTagInput, UpdateTagInput } from '../lib/tag';
import type { Database } from './client';
import { postTags, tags } from './schema';

export type TagMutationResult = {
	changed: boolean;
	publicPostIds: number[];
	slug: string;
	tagId: number;
};

export type TagMergeResult = {
	publicPostIds: number[];
	sourceSlug: string;
	sourceTagId: number;
	targetSlug: string;
	targetTagId: number;
};

export function buildManageableTagsQuery(database: Pick<Database, 'select'>) {
	return database
		.select({
			createdAt: tags.createdAt,
			description: tags.description,
			displayName: tags.displayName,
			id: tags.id,
			postCount: count(postTags.postId).mapWith(Number),
			slug: tags.slug,
			updatedAt: tags.updatedAt,
		})
		.from(tags)
		.leftJoin(postTags, eq(postTags.tagId, tags.id))
		.groupBy(tags.id)
		.orderBy(asc(tags.displayName), asc(tags.slug));
}

export async function listManageableTags(database: Database) {
	return buildManageableTagsQuery(database);
}

export async function createTag(
	database: Database,
	input: CreateTagInput,
): Promise<TagMutationResult | null> {
	const result = await database.execute<TagMutationResult>(sql`
		insert into tags (slug, display_name, description)
		values (${input.slug}, ${input.displayName}, ${input.description})
		returning
			id as "tagId",
			slug,
			true as changed,
			'{}'::integer[] as "publicPostIds"
	`);

	return result.rows[0] ?? null;
}

export async function updateTag(
	database: Database,
	input: UpdateTagInput,
): Promise<TagMutationResult | null> {
	const result = await database.execute<TagMutationResult>(sql`
		with target_tag as materialized (
			select tags.id, tags.slug, tags.display_name, tags.description
			from tags
			where tags.id = ${input.tagId}
			for update of tags
		), affected_public_posts as materialized (
			select distinct posts.id
			from posts
			inner join post_tags on post_tags.post_id = posts.id
			inner join target_tag on target_tag.id = post_tags.tag_id
			where posts.status = 'active' and posts.visibility = 'public'
		), updated_tag as (
			update tags
			set
				slug = ${input.slug},
				display_name = ${input.displayName},
				description = ${input.description},
				updated_at = now()
			from target_tag
			where tags.id = target_tag.id
			returning tags.id, tags.slug
		)
		select
			updated_tag.id as "tagId",
			updated_tag.slug,
			(target_tag.slug is distinct from ${input.slug}
				or target_tag.display_name is distinct from ${input.displayName}
				or target_tag.description is distinct from ${input.description}) as changed,
			coalesce(
				(select array_agg(affected_public_posts.id order by affected_public_posts.id) from affected_public_posts),
				'{}'::integer[]
			) as "publicPostIds"
		from updated_tag, target_tag
	`);

	return result.rows[0] ?? null;
}

export async function mergeTags(
	database: Database,
	input: Pick<MergeTagInput, 'sourceTagId' | 'targetTagId'>,
): Promise<TagMergeResult | null> {
	const result = await database.execute<TagMergeResult>(sql`
		with source_tag as materialized (
			select tags.id, tags.slug
			from tags
			where tags.id = ${input.sourceTagId}
			for update of tags
		), target_tag as materialized (
			select tags.id, tags.slug
			from tags
			where tags.id = ${input.targetTagId}
				and tags.id <> ${input.sourceTagId}
			for update of tags
		), affected_public_posts as materialized (
			select distinct posts.id
			from posts
			inner join post_tags on post_tags.post_id = posts.id
			where post_tags.tag_id in (
				select source_tag.id from source_tag
				union all
				select target_tag.id from target_tag
			)
				and posts.status = 'active'
				and posts.visibility = 'public'
		), inserted_links as (
			insert into post_tags (post_id, tag_id)
			select post_tags.post_id, target_tag.id
			from post_tags, source_tag, target_tag
			where post_tags.tag_id = source_tag.id
			on conflict (post_id, tag_id) do nothing
			returning post_id
		), deleted_source as (
			delete from tags
			using source_tag, target_tag
			where tags.id = source_tag.id
				and (select count(*) from inserted_links) >= 0
			returning tags.id, tags.slug
		)
		select
			deleted_source.id as "sourceTagId",
			deleted_source.slug as "sourceSlug",
			target_tag.id as "targetTagId",
			target_tag.slug as "targetSlug",
			coalesce(
				(select array_agg(affected_public_posts.id order by affected_public_posts.id) from affected_public_posts),
				'{}'::integer[]
			) as "publicPostIds"
		from deleted_source, target_tag
	`);

	return result.rows[0] ?? null;
}

export async function findTagPurgeContext(database: Database, tagId: number) {
	const result = await database.execute<{ publicPostIds: number[]; tagId: number }>(sql`
		select
			tags.id as "tagId",
			coalesce(
				array_agg(posts.id order by posts.id) filter (where posts.id is not null),
				'{}'::integer[]
			) as "publicPostIds"
		from tags
		left join post_tags on post_tags.tag_id = tags.id
		left join posts on posts.id = post_tags.post_id
			and posts.status = 'active'
			and posts.visibility = 'public'
		where tags.id = ${tagId}
		group by tags.id
	`);

	return result.rows[0] ?? null;
}
