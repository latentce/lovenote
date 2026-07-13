import { and, asc, desc, eq, lt, ne, or, type SQL } from 'drizzle-orm';

import type { AuthenticatedUser } from '../lib/auth';
import { isActiveMember, isOwner } from '../lib/authorization';
import { decodePostCursor, encodePostCursor, type PostCursor } from '../lib/post';
import { user } from './auth-schema';
import type { Database } from './client';
import { mediaAssets, posts } from './schema';

export const PUBLIC_POST_PAGE_SIZE = 20;

function afterPostCursor(cursor: PostCursor | null): SQL | undefined {
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

const postSummarySelection = {
	id: posts.id,
	authorId: posts.authorId,
	authorUsername: user.displayUsername,
	body: posts.body,
	visibility: posts.visibility,
	status: posts.status,
	createdAt: posts.createdAt,
	updatedAt: posts.updatedAt,
};

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

export async function findVisiblePost(
	database: Database,
	postId: number,
	viewer: AuthenticatedUser | null,
) {
	const rows = await database
		.select(postSummarySelection)
		.from(posts)
		.innerJoin(user, eq(posts.authorId, user.id))
		.where(and(eq(posts.id, postId), visiblePostFilter(viewer)))
		.limit(1);

	return rows[0] ?? null;
}
