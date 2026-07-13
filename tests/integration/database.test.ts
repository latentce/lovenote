import { randomUUID } from 'node:crypto';

import { count, eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listPublicArchive } from '../../src/db/archive-queries';
import { user } from '../../src/db/auth-schema';
import { createDatabase } from '../../src/db/client';
import { findPostDetail, listPrivatePosts, listPublicPosts } from '../../src/db/post-queries';
import {
	comments,
	favorites,
	mediaAssets,
	memberPermissions,
	posts,
	postTags,
	setupState,
	tags,
} from '../../src/db/schema';
import type { AuthenticatedUser } from '../../src/lib/auth';

const databaseUrl = process.env.INTEGRATION_DATABASE_URL!;
const database = createDatabase(databaseUrl);
const runId = randomUUID();
const ownerId = `integration-owner-${runId}`;
const authorId = `integration-author-${runId}`;
const otherId = `integration-other-${runId}`;
const fixtureUserIds = [ownerId, authorId, otherId];
const tagIds: number[] = [];

let schemaReady = false;
let newestPublicPostId: number;
let privatePostId: number;
let authorHiddenPostId: number;
let otherHiddenPostId: number;
let deletingPostId: number;

function fixtureUser(id: string, role: 'admin' | 'user' = 'user') {
	return { banned: false, id, role } as AuthenticatedUser;
}

async function assertDisposableDatabaseIsEmpty() {
	const results = await Promise.all([
		database.select({ value: count() }).from(user),
		database.select({ value: count() }).from(setupState),
		database.select({ value: count() }).from(posts),
		database.select({ value: count() }).from(mediaAssets),
		database.select({ value: count() }).from(tags),
		database.select({ value: count() }).from(comments),
		database.select({ value: count() }).from(favorites),
	]);
	const names = ['users', 'setup state', 'posts', 'media assets', 'tags', 'comments', 'favorites'];
	const populated = results
		.map(([row], index) => ({ count: row.value, name: names[index] }))
		.filter(({ count: rowCount }) => rowCount > 0);

	if (populated.length > 0) {
		throw new Error(
			`Integration database is not empty (${populated.map(({ count: rowCount, name }) => `${name}: ${rowCount}`).join(', ')}). Use a fresh, disposable Neon branch.`,
		);
	}
}

async function seedFixtures() {
	await database.insert(user).values([
		{
			displayUsername: 'Integration Owner',
			email: `owner-${runId}@test.invalid`,
			id: ownerId,
			name: `owner-${runId}`,
			role: 'admin',
			username: `owner-${runId}`,
		},
		{
			displayUsername: 'Integration Author',
			email: `author-${runId}@test.invalid`,
			id: authorId,
			name: `author-${runId}`,
			role: 'user',
			username: `author-${runId}`,
		},
		{
			displayUsername: 'Integration Other',
			email: `other-${runId}@test.invalid`,
			id: otherId,
			name: `other-${runId}`,
			role: 'user',
			username: `other-${runId}`,
		},
	]);

	await database.insert(memberPermissions).values(
		fixtureUserIds.map((userId) => ({
			temporaryPassword: false,
			userId,
		})),
	);

	const publicRows = await database
		.insert(posts)
		.values(
			Array.from({ length: 21 }, (_, index) => ({
				authorId,
				body: `integration-${runId}-public-${index}`,
				createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
				status: 'active' as const,
				visibility: 'public' as const,
			})),
		)
		.returning({ body: posts.body, id: posts.id });
	newestPublicPostId = publicRows.find(({ body }) => body.endsWith('-public-20'))!.id;

	const specialPosts = await database
		.insert(posts)
		.values([
			{
				authorId,
				body: `integration-${runId}-private`,
				status: 'active',
				visibility: 'private',
			},
			{
				authorId,
				body: `integration-${runId}-author-hidden`,
				status: 'hidden',
				visibility: 'private',
			},
			{
				authorId: otherId,
				body: `integration-${runId}-other-hidden`,
				status: 'hidden',
				visibility: 'private',
			},
			{
				authorId,
				body: `integration-${runId}-deleting`,
				status: 'deleting',
				visibility: 'public',
			},
		])
		.returning({ body: posts.body, id: posts.id });

	privatePostId = specialPosts.find(({ body }) => body.endsWith('-private'))!.id;
	authorHiddenPostId = specialPosts.find(({ body }) => body.endsWith('-author-hidden'))!.id;
	otherHiddenPostId = specialPosts.find(({ body }) => body.endsWith('-other-hidden'))!.id;
	deletingPostId = specialPosts.find(({ body }) => body.endsWith('-deleting'))!.id;

	await database.insert(mediaAssets).values([
		{
			attachmentOrder: 1,
			byteSize: 20,
			etag: 'integration-etag-1',
			height: 20,
			kind: 'image',
			mimeType: 'image/webp',
			objectKey: `integration/${runId}/second.webp`,
			originalFilename: 'second.webp',
			postId: newestPublicPostId,
			uploaderId: authorId,
			uploadState: 'ready',
			width: 20,
		},
		{
			attachmentOrder: 0,
			byteSize: 10,
			etag: 'integration-etag-0',
			height: 10,
			kind: 'image',
			mimeType: 'image/webp',
			objectKey: `integration/${runId}/first.webp`,
			originalFilename: 'first.webp',
			postId: newestPublicPostId,
			uploaderId: authorId,
			uploadState: 'ready',
			width: 10,
		},
		{
			attachmentOrder: 0,
			byteSize: 30,
			etag: 'integration-private-etag',
			height: 30,
			kind: 'image',
			mimeType: 'image/webp',
			objectKey: `integration/${runId}/private.webp`,
			originalFilename: 'private.webp',
			postId: privatePostId,
			uploaderId: authorId,
			uploadState: 'ready',
			width: 30,
		},
		{
			attachmentOrder: 0,
			byteSize: 40,
			etag: 'integration-deleting-etag',
			height: 40,
			kind: 'image',
			mimeType: 'image/webp',
			objectKey: `integration/${runId}/deleting.webp`,
			originalFilename: 'deleting.webp',
			postId: deletingPostId,
			uploaderId: authorId,
			uploadState: 'ready',
			width: 40,
		},
	]);

	const insertedTags = await database
		.insert(tags)
		.values([
			{
				displayName: 'Integration Alpha',
				slug: `integration-${runId}-alpha`,
			},
			{
				displayName: 'Integration Beta',
				slug: `integration-${runId}-beta`,
			},
		])
		.returning({ id: tags.id });
	tagIds.push(...insertedTags.map(({ id }) => id));
}

beforeAll(async () => {
	await migrate(database, { migrationsFolder: './drizzle' });
	schemaReady = true;
	await assertDisposableDatabaseIsEmpty();
	await seedFixtures();
});

afterAll(async () => {
	if (!schemaReady) return;

	await database.delete(posts).where(inArray(posts.authorId, fixtureUserIds));
	if (tagIds.length > 0) {
		await database.delete(tags).where(inArray(tags.id, tagIds));
	}
	await database.delete(user).where(inArray(user.id, fixtureUserIds));
});

describe('Neon database acceptance', () => {
	it('applies every committed migration and creates the expected schema', async () => {
		const [permissionCount] = await database
			.select({ value: count() })
			.from(memberPermissions)
			.where(inArray(memberPermissions.userId, fixtureUserIds));

		expect(permissionCount.value).toBe(3);
	});

	it('enforces unique favorites and post-tag joins', async () => {
		await database.insert(favorites).values({ postId: deletingPostId, userId: authorId });
		await expect(
			database.insert(favorites).values({ postId: deletingPostId, userId: authorId }),
		).rejects.toThrow();

		await database.insert(postTags).values({ postId: deletingPostId, tagId: tagIds[0] });
		await expect(
			database.insert(postTags).values({ postId: deletingPostId, tagId: tagIds[0] }),
		).rejects.toThrow();
	});

	it('orders attachments and isolates the public media archive', async () => {
		const publicPage = await listPublicPosts(database, null, 100);
		const post = publicPage.items.find(({ id }) => id === newestPublicPostId);
		const archive = await listPublicArchive(database, null, 100);

		expect(post?.media.map(({ attachmentOrder }) => attachmentOrder)).toEqual([0, 1]);
		expect(archive.items).toHaveLength(2);
		expect(new Set(archive.items.map(({ postId }) => postId))).toEqual(
			new Set([newestPublicPostId]),
		);
	});

	it('paginates the public feed with a stable created-at and id cursor', async () => {
		const firstPage = await listPublicPosts(database);
		expect(firstPage.items).toHaveLength(20);
		expect(firstPage.nextCursor).not.toBeNull();

		const secondPage = await listPublicPosts(database, firstPage.nextCursor);
		expect(secondPage.items).toHaveLength(1);
		expect(secondPage.nextCursor).toBeNull();
		expect(new Set([...firstPage.items, ...secondPage.items].map(({ id }) => id)).size).toBe(21);
	});

	it('isolates public, private, hidden, and deleting posts by viewer', async () => {
		const anonymousPublic = await listPublicPosts(database, null, 100);
		const authorPrivate = await listPrivatePosts(database, fixtureUser(authorId), null, 100);
		const otherPrivate = await listPrivatePosts(database, fixtureUser(otherId), null, 100);
		const ownerPrivate = await listPrivatePosts(database, fixtureUser(ownerId, 'admin'), null, 100);

		expect(anonymousPublic.items).toHaveLength(21);
		expect(authorPrivate.items.map(({ id }) => id)).toEqual(
			expect.arrayContaining([privatePostId, authorHiddenPostId]),
		);
		expect(authorPrivate.items.map(({ id }) => id)).not.toContain(otherHiddenPostId);
		expect(otherPrivate.items.map(({ id }) => id)).toEqual(
			expect.arrayContaining([privatePostId, otherHiddenPostId]),
		);
		expect(otherPrivate.items.map(({ id }) => id)).not.toContain(authorHiddenPostId);
		expect(ownerPrivate.items.map(({ id }) => id)).toEqual(
			expect.arrayContaining([privatePostId, authorHiddenPostId, otherHiddenPostId]),
		);

		expect(await findPostDetail(database, privatePostId, null)).toBeNull();
		expect(await findPostDetail(database, authorHiddenPostId, fixtureUser(otherId))).toBeNull();
		expect(await findPostDetail(database, deletingPostId, fixtureUser(ownerId, 'admin'))).toBeNull();
	});

	it('cascades dependent rows when a post is deleted', async () => {
		await database.insert(comments).values({
			authorId,
			body: 'Integration cascade comment',
			postId: deletingPostId,
		});
		await database.delete(posts).where(eq(posts.id, deletingPostId));

		const [remainingMedia, remainingComments, remainingFavorites, remainingTags] =
			await Promise.all([
				database.select({ value: count() }).from(mediaAssets).where(eq(mediaAssets.postId, deletingPostId)),
				database.select({ value: count() }).from(comments).where(eq(comments.postId, deletingPostId)),
				database.select({ value: count() }).from(favorites).where(eq(favorites.postId, deletingPostId)),
				database.select({ value: count() }).from(postTags).where(eq(postTags.postId, deletingPostId)),
			]);

		expect([
			remainingMedia[0].value,
			remainingComments[0].value,
			remainingFavorites[0].value,
			remainingTags[0].value,
		]).toEqual([0, 0, 0, 0]);
	});
});
