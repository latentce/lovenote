import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { decodePostCursor, encodePostCursor, type PostCursor } from '../lib/post';
import type { Database } from './client';
import { afterPostCursor, PUBLIC_POST_PAGE_SIZE } from './post-queries';
import { mediaAssets, posts, postTags, tags } from './schema';

const publicPostCount = sql<number>`count(distinct ${posts.id})::integer`;

export function buildAssignableTagsQuery(database: Pick<Database, 'select'>) {
	return database
		.select({
			displayName: tags.displayName,
			id: tags.id,
			slug: tags.slug,
		})
		.from(tags)
		.orderBy(asc(tags.displayName), asc(tags.slug));
}

export async function listAssignableTags(database: Database) {
	return buildAssignableTagsQuery(database);
}

export function buildPublicTagsQuery(database: Pick<Database, 'select'>, slug?: string) {
	const isLookup = slug !== undefined;
	const query = database
		.select({
			description: tags.description,
			displayName: tags.displayName,
			id: tags.id,
			postCount: publicPostCount,
			slug: tags.slug,
		})
		.from(tags)
		.innerJoin(postTags, eq(postTags.tagId, tags.id))
		.innerJoin(
			posts,
			and(
				eq(postTags.postId, posts.id),
				eq(posts.status, 'active'),
				eq(posts.visibility, 'public'),
			),
		)
		.where(isLookup ? eq(tags.slug, slug) : undefined)
		.groupBy(tags.id)
		.orderBy(asc(tags.displayName), asc(tags.slug));

	return isLookup ? query.limit(1) : query;
}

export async function listPublicTags(database: Database) {
	return buildPublicTagsQuery(database);
}

export async function findPublicTag(database: Database, slug: string) {
	const rows = await buildPublicTagsQuery(database, slug);
	return rows[0] ?? null;
}

export function buildPublicTagPostsQuery(
	database: Pick<Database, 'query' | 'select'>,
	tagId: number,
	cursor: PostCursor | null,
	limit: number,
) {
	const taggedPostIds = database
		.select({ postId: postTags.postId })
		.from(postTags)
		.where(eq(postTags.tagId, tagId));

	return database.query.posts.findMany({
		columns: {
			authorId: true,
			body: true,
			createdAt: true,
			id: true,
			status: true,
			updatedAt: true,
			visibility: true,
		},
		limit: limit + 1,
		orderBy: [desc(posts.createdAt), desc(posts.id)],
		where: and(
			eq(posts.status, 'active'),
			eq(posts.visibility, 'public'),
			afterPostCursor(cursor),
			inArray(posts.id, taggedPostIds),
		),
		with: {
			author: {
				columns: {
					displayUsername: true,
					name: true,
				},
			},
			media: {
				columns: {
					altText: true,
					attachmentOrder: true,
					byteSize: true,
					deliveryRevision: true,
					durationMs: true,
					height: true,
					id: true,
					kind: true,
					mimeType: true,
					originalFilename: true,
					width: true,
				},
				orderBy: [asc(mediaAssets.attachmentOrder)],
				where: eq(mediaAssets.uploadState, 'ready'),
			},
		},
	});
}

export async function listPublicTagPosts(
	database: Database,
	tagId: number,
	cursorValue?: string | null,
	pageSize = PUBLIC_POST_PAGE_SIZE,
) {
	const cursor = decodePostCursor(cursorValue);
	const requestedLimit = Number.isFinite(pageSize) ? Math.trunc(pageSize) : PUBLIC_POST_PAGE_SIZE;
	const limit = Math.min(Math.max(requestedLimit, 1), 100);
	const rows = await buildPublicTagPostsQuery(database, tagId, cursor, limit);

	const hasNextPage = rows.length > limit;
	const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
	const items = pageRows.map(({ author, ...post }) => ({
		...post,
		authorUsername: author.displayUsername ?? author.name,
	}));
	const finalPost = items.at(-1);

	return {
		items,
		nextCursor:
			hasNextPage && finalPost
				? encodePostCursor({ createdAt: finalPost.createdAt, id: finalPost.id })
				: null,
	};
}

export type PublicTag = Awaited<ReturnType<typeof listPublicTags>>[number];
