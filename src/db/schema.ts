import { relations, sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	check,
	index,
	integer,
	pgEnum,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core';

import { user } from './auth-schema';

const timestamps = {
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
};

export const postVisibility = pgEnum('post_visibility', ['public', 'private']);
export const postStatus = pgEnum('post_status', ['active', 'hidden', 'deleting']);
export const mediaKind = pgEnum('media_kind', ['image', 'video']);
export const mediaUploadState = pgEnum('media_upload_state', ['pending', 'ready']);
export const commentStatus = pgEnum('comment_status', ['visible', 'hidden']);

export const setupState = pgTable('setup_state', {
	key: text('key').primaryKey(),
	initializedAt: timestamp('initialized_at', { withTimezone: true }).defaultNow().notNull(),
});

export const memberPermissions = pgTable('member_permissions', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	createPosts: boolean('create_posts').default(true).notNull(),
	editOwnPosts: boolean('edit_own_posts').default(true).notNull(),
	hideOwnPosts: boolean('hide_own_posts').default(true).notNull(),
	deleteOwnPosts: boolean('delete_own_posts').default(true).notNull(),
	uploadImages: boolean('upload_images').default(true).notNull(),
	uploadVideos: boolean('upload_videos').default(true).notNull(),
	createComments: boolean('create_comments').default(true).notNull(),
	favoritePosts: boolean('favorite_posts').default(true).notNull(),
	manageTags: boolean('manage_tags').default(false).notNull(),
	moderateComments: boolean('moderate_comments').default(false).notNull(),
	temporaryPassword: boolean('temporary_password').default(true).notNull(),
	...timestamps,
});

export const posts = pgTable(
	'posts',
	{
		id: serial('id').primaryKey(),
		authorId: text('author_id')
			.notNull()
			.references(() => user.id),
		body: text('body').default('').notNull(),
		visibility: postVisibility('visibility').default('private').notNull(),
		status: postStatus('status').default('active').notNull(),
		...timestamps,
	},
	(table) => [
		index('posts_public_feed_idx').on(
			table.visibility,
			table.status,
			table.createdAt.desc(),
			table.id.desc(),
		),
		index('posts_author_idx').on(table.authorId, table.status, table.createdAt.desc(), table.id.desc()),
		check('posts_body_length_check', sql`char_length(${table.body}) <= 10000`),
	],
);

export const mediaAssets = pgTable(
	'media_assets',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		postId: integer('post_id').references(() => posts.id, { onDelete: 'cascade' }),
		uploaderId: text('uploader_id')
			.notNull()
			.references(() => user.id),
		kind: mediaKind('kind').notNull(),
		objectKey: text('object_key').notNull(),
		originalFilename: varchar('original_filename', { length: 255 }).notNull(),
		mimeType: varchar('mime_type', { length: 255 }).notNull(),
		byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
		width: integer('width'),
		height: integer('height'),
		durationMs: integer('duration_ms'),
		etag: text('etag'),
		altText: varchar('alt_text', { length: 1000 }).default('').notNull(),
		attachmentOrder: integer('attachment_order'),
		uploadState: mediaUploadState('upload_state').default('pending').notNull(),
		deliveryRevision: integer('delivery_revision').default(1).notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		...timestamps,
	},
	(table) => [
		uniqueIndex('media_assets_object_key_unique').on(table.objectKey),
		uniqueIndex('media_assets_post_order_unique')
			.on(table.postId, table.attachmentOrder)
			.where(sql`${table.postId} is not null`),
		index('media_assets_post_idx').on(table.postId, table.attachmentOrder),
		index('media_assets_cleanup_idx').on(table.uploadState, table.expiresAt),
		index('media_assets_uploader_idx').on(table.uploaderId, table.uploadState, table.createdAt),
		index('media_assets_archive_idx').on(table.createdAt.desc(), table.id.desc()),
		check('media_assets_byte_size_check', sql`${table.byteSize} > 0`),
		check(
			'media_assets_dimensions_check',
			sql`(${table.width} is null or ${table.width} > 0) and (${table.height} is null or ${table.height} > 0)`,
		),
		check(
			'media_assets_duration_check',
			sql`${table.durationMs} is null or ${table.durationMs} >= 0`,
		),
		check(
			'media_assets_attachment_order_check',
			sql`${table.attachmentOrder} is null or ${table.attachmentOrder} between 0 and 3`,
		),
		check(
			'media_assets_attachment_pair_check',
			sql`(${table.postId} is null and ${table.attachmentOrder} is null) or (${table.postId} is not null and ${table.attachmentOrder} is not null)`,
		),
		check(
			'media_assets_ready_etag_check',
			sql`${table.uploadState} = 'pending' or ${table.etag} is not null`,
		),
		check('media_assets_delivery_revision_check', sql`${table.deliveryRevision} > 0`),
	],
);

export const tags = pgTable(
	'tags',
	{
		id: serial('id').primaryKey(),
		slug: varchar('slug', { length: 64 }).notNull(),
		displayName: varchar('display_name', { length: 64 }).notNull(),
		description: text('description').default('').notNull(),
		...timestamps,
	},
	(table) => [
		uniqueIndex('tags_slug_unique').on(table.slug),
		check('tags_slug_lowercase_check', sql`${table.slug} = lower(${table.slug})`),
		check('tags_slug_not_empty_check', sql`char_length(${table.slug}) > 0`),
	],
);

export const postTags = pgTable(
	'post_tags',
	{
		postId: integer('post_id')
			.notNull()
			.references(() => posts.id, { onDelete: 'cascade' }),
		tagId: integer('tag_id')
			.notNull()
			.references(() => tags.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.postId, table.tagId] }),
		index('post_tags_tag_archive_idx').on(table.tagId, table.postId),
	],
);

export const comments = pgTable(
	'comments',
	{
		id: serial('id').primaryKey(),
		postId: integer('post_id')
			.notNull()
			.references(() => posts.id, { onDelete: 'cascade' }),
		authorId: text('author_id')
			.notNull()
			.references(() => user.id),
		body: text('body').notNull(),
		status: commentStatus('status').default('visible').notNull(),
		...timestamps,
	},
	(table) => [
		index('comments_post_idx').on(table.postId, table.status, table.createdAt, table.id),
		index('comments_author_idx').on(table.authorId, table.createdAt.desc()),
		check('comments_body_length_check', sql`char_length(${table.body}) between 1 and 2000`),
	],
);

export const favorites = pgTable(
	'favorites',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		postId: integer('post_id')
			.notNull()
			.references(() => posts.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.postId] }),
		index('favorites_post_idx').on(table.postId, table.createdAt),
	],
);

export const postsRelations = relations(posts, ({ one, many }) => ({
	author: one(user, { fields: [posts.authorId], references: [user.id] }),
	media: many(mediaAssets),
	tags: many(postTags),
	comments: many(comments),
	favorites: many(favorites),
}));

export const mediaAssetsRelations = relations(mediaAssets, ({ one }) => ({
	post: one(posts, { fields: [mediaAssets.postId], references: [posts.id] }),
	uploader: one(user, { fields: [mediaAssets.uploaderId], references: [user.id] }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
	posts: many(postTags),
}));

export const postTagsRelations = relations(postTags, ({ one }) => ({
	post: one(posts, { fields: [postTags.postId], references: [posts.id] }),
	tag: one(tags, { fields: [postTags.tagId], references: [tags.id] }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
	post: one(posts, { fields: [comments.postId], references: [posts.id] }),
	author: one(user, { fields: [comments.authorId], references: [user.id] }),
}));

export const favoritesRelations = relations(favorites, ({ one }) => ({
	post: one(posts, { fields: [favorites.postId], references: [posts.id] }),
	user: one(user, { fields: [favorites.userId], references: [user.id] }),
}));

export const memberPermissionsRelations = relations(memberPermissions, ({ one }) => ({
	user: one(user, { fields: [memberPermissions.userId], references: [user.id] }),
}));
