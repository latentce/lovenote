import { and, asc, desc, eq, lt, ne, or, sql, type SQL } from 'drizzle-orm';

import type { AuthenticatedUser } from '../lib/auth';
import { isActiveMember, isOwner } from '../lib/authorization';
import { decodePostCursor, encodePostCursor, type PostCursor } from '../lib/post';
import type { Database } from './client';
import { comments, mediaAssets, posts } from './schema';

export const PUBLIC_POST_PAGE_SIZE = 20;
export const AUTHOR_POST_LIMIT = 50;

export function afterPostCursor(cursor: PostCursor | null): SQL | undefined {
	if (!cursor) {
		return undefined;
	}

	return or(
		lt(posts.createdAt, cursor.createdAt),
		and(eq(posts.createdAt, cursor.createdAt), lt(posts.id, cursor.id)),
	);
}

export function visiblePostFilter(viewer: AuthenticatedUser | null): SQL {
	if (isOwner(viewer)) {
		return ne(posts.status, 'deleting');
	}

	if (isActiveMember(viewer)) {
		return or(
			eq(posts.status, 'active'),
			and(eq(posts.status, 'hidden'), eq(posts.authorId, viewer.id)),
		)!;
	}

	return and(eq(posts.status, 'active'), eq(posts.visibility, 'public'))!;
}

export function buildPublicPostsQuery(
	database: Pick<Database, 'query'>,
	cursor: PostCursor | null,
	limit: number,
) {
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

export async function listPublicPosts(
	database: Database,
	cursorValue?: string | null,
	pageSize = PUBLIC_POST_PAGE_SIZE,
) {
	const cursor = decodePostCursor(cursorValue);
	const requestedLimit = Number.isFinite(pageSize) ? Math.trunc(pageSize) : PUBLIC_POST_PAGE_SIZE;
	const limit = Math.min(Math.max(requestedLimit, 1), 100);
	const rows = await buildPublicPostsQuery(database, cursor, limit);

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

export type PublicPostSummary = Awaited<ReturnType<typeof listPublicPosts>>['items'][number];
export type PostMediaSummary = PublicPostSummary['media'][number];

export function buildPrivatePostsQuery(
	database: Pick<Database, 'query'>,
	cursor: PostCursor | null,
	limit: number,
	viewer: AuthenticatedUser,
) {
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
			eq(posts.visibility, 'private'),
			visiblePostFilter(viewer),
			afterPostCursor(cursor),
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

export async function listPrivatePosts(
	database: Database,
	viewer: AuthenticatedUser,
	cursorValue?: string | null,
	pageSize = PUBLIC_POST_PAGE_SIZE,
) {
	const cursor = decodePostCursor(cursorValue);
	const requestedLimit = Number.isFinite(pageSize) ? Math.trunc(pageSize) : PUBLIC_POST_PAGE_SIZE;
	const limit = Math.min(Math.max(requestedLimit, 1), 100);
	const rows = await buildPrivatePostsQuery(database, cursor, limit, viewer);

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

export type PrivatePostSummary = Awaited<ReturnType<typeof listPrivatePosts>>['items'][number];

export function buildOwnPostsQuery(
	database: Pick<Database, 'query'>,
	authorId: string,
	limit = AUTHOR_POST_LIMIT,
) {
	return database.query.posts.findMany({
		columns: {
			body: true,
			createdAt: true,
			id: true,
			status: true,
			updatedAt: true,
			visibility: true,
		},
		limit,
		orderBy: [desc(posts.createdAt), desc(posts.id)],
		where: eq(posts.authorId, authorId),
	});
}

export async function listOwnPosts(database: Database, authorId: string) {
	return buildOwnPostsQuery(database, authorId);
}

export type OwnPostSummary = Awaited<ReturnType<typeof listOwnPosts>>[number];

export function buildOwnPostForEditQuery(
	database: Pick<Database, 'query'>,
	authorId: string,
	postId: number,
) {
	return database.query.posts.findFirst({
		columns: {
			body: true,
			id: true,
			status: true,
			visibility: true,
		},
		where: and(
			eq(posts.id, postId),
			eq(posts.authorId, authorId),
			ne(posts.status, 'deleting'),
		),
		with: {
			media: {
				columns: { id: true },
				where: eq(mediaAssets.uploadState, 'ready'),
			},
			tags: {
				columns: { tagId: true },
			},
		},
	});
}

export async function findOwnPostForEdit(
	database: Database,
	authorId: string,
	postId: number,
) {
	const post = await buildOwnPostForEditQuery(database, authorId, postId);
	if (!post) return null;

	const { media, tags: assignedTags, ...editablePost } = post;
	return {
		...editablePost,
		hasMedia: media.length > 0,
		tagIds: assignedTags.map(({ tagId }) => tagId),
	};
}

export function buildPostDetailQuery(
	database: Pick<Database, 'query'>,
	postId: number,
	viewer: AuthenticatedUser | null,
) {
	return database.query.posts.findFirst({
		columns: {
			authorId: true,
			body: true,
			createdAt: true,
			id: true,
			status: true,
			updatedAt: true,
			visibility: true,
		},
		extras: {
			favoriteCount: sql<number>`(
				select count(*)::integer
				from "favorites"
				where "favorites"."post_id" = ${posts.id}
			)`.as('favorite_count'),
		},
		where: and(eq(posts.id, postId), visiblePostFilter(viewer)),
		with: {
			author: {
				columns: {
					displayUsername: true,
					name: true,
				},
			},
			comments: {
				columns: {
					authorId: true,
					body: true,
					createdAt: true,
					id: true,
					updatedAt: true,
				},
				orderBy: [asc(comments.createdAt), asc(comments.id)],
				where: eq(comments.status, 'visible'),
				with: {
					author: {
						columns: {
							displayUsername: true,
							name: true,
						},
					},
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
			tags: {
				columns: {
					tagId: true,
				},
				with: {
					tag: {
						columns: {
							description: true,
							displayName: true,
							id: true,
							slug: true,
						},
					},
				},
			},
		},
	});
}

export async function findPostDetail(
	database: Database,
	postId: number,
	viewer: AuthenticatedUser | null,
) {
	const post = await buildPostDetailQuery(database, postId, viewer);

	if (!post) {
		return null;
	}

	return {
		...post,
		authorUsername: post.author.displayUsername ?? post.author.name,
		comments: post.comments.map(({ author, ...comment }) => ({
			...comment,
			authorUsername: author.displayUsername ?? author.name,
		})),
		tags: post.tags
			.map(({ tag }) => tag)
			.sort((first, second) => first.slug.localeCompare(second.slug)),
	};
}

export type PostDetail = NonNullable<Awaited<ReturnType<typeof findPostDetail>>>;
