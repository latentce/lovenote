import { asc, eq, sql } from 'drizzle-orm';

import type { NewMemberPermissions, UpdateMemberPermissionsInput } from '../lib/member';
import { MAX_MEMBER_ACCOUNTS } from '../lib/member';
import { user } from './auth-schema';
import type { Database } from './client';
import { memberPermissions } from './schema';

export function buildMemberListQuery(database: Pick<Database, 'select'>) {
	return database
		.select({
			banned: user.banned,
			createdAt: user.createdAt,
			displayUsername: sql<string>`coalesce(${user.displayUsername}, ${user.name})`,
			id: user.id,
			role: user.role,
			createComments: memberPermissions.createComments,
			createPosts: memberPermissions.createPosts,
			deleteOwnPosts: memberPermissions.deleteOwnPosts,
			editOwnPosts: memberPermissions.editOwnPosts,
			favoritePosts: memberPermissions.favoritePosts,
			hideOwnPosts: memberPermissions.hideOwnPosts,
			manageTags: memberPermissions.manageTags,
			moderateComments: memberPermissions.moderateComments,
			temporaryPassword: memberPermissions.temporaryPassword,
			uploadImages: memberPermissions.uploadImages,
			uploadVideos: memberPermissions.uploadVideos,
		})
		.from(user)
		.leftJoin(memberPermissions, eq(memberPermissions.userId, user.id))
		.orderBy(asc(user.createdAt), asc(user.id));
}

export async function listMembers(database: Database) {
	return buildMemberListQuery(database);
}

export async function countMembers(database: Database) {
	const result = await database.select({ value: sql<number>`count(*)::integer` }).from(user);
	return result[0]?.value ?? 0;
}

export async function addMemberPermissions(
	database: Database,
	userId: string,
	permissions: NewMemberPermissions,
) {
	const result = await database.execute<{ userId: string }>(sql`
		with ranked_user as (
			select
				"user".id,
				row_number() over (order by "user".created_at, "user".id) as account_number
			from "user"
		), eligible_user as (
			select ranked_user.id
			from ranked_user
			where ranked_user.id = ${userId}
				and ranked_user.account_number <= ${MAX_MEMBER_ACCOUNTS}
		)
		insert into member_permissions (
			user_id,
			create_posts,
			edit_own_posts,
			hide_own_posts,
			delete_own_posts,
			upload_images,
			upload_videos,
			create_comments,
			favorite_posts,
			manage_tags,
			moderate_comments,
			temporary_password
		)
		select
			eligible_user.id,
			${permissions.createPosts},
			${permissions.editOwnPosts},
			${permissions.hideOwnPosts},
			${permissions.deleteOwnPosts},
			${permissions.uploadImages},
			${permissions.uploadVideos},
			${permissions.createComments},
			${permissions.favoritePosts},
			${permissions.manageTags},
			${permissions.moderateComments},
			true
		from eligible_user
		on conflict (user_id) do nothing
		returning user_id as "userId"
	`);

	return result.rows[0]?.userId ?? null;
}

export async function updateMemberPermissions(
	database: Database,
	input: UpdateMemberPermissionsInput,
) {
	const result = await database.execute<{ userId: string }>(sql`
		update member_permissions
		set
			create_posts = ${input.createPosts},
			edit_own_posts = ${input.editOwnPosts},
			hide_own_posts = ${input.hideOwnPosts},
			delete_own_posts = ${input.deleteOwnPosts},
			upload_images = ${input.uploadImages},
			upload_videos = ${input.uploadVideos},
			create_comments = ${input.createComments},
			favorite_posts = ${input.favoritePosts},
			manage_tags = ${input.manageTags},
			moderate_comments = ${input.moderateComments},
			updated_at = now()
		from "user"
		where member_permissions.user_id = ${input.userId}
			and "user".id = member_permissions.user_id
			and not (
				'admin' = any(string_to_array(coalesce("user".role, ''), ','))
			)
		returning member_permissions.user_id as "userId"
	`);

	return result.rows[0]?.userId ?? null;
}

export async function findManageableMember(database: Database, userId: string) {
	const result = await database.execute<{ banned: boolean | null; id: string }>(sql`
		select "user".id, "user".banned
		from "user"
		where "user".id = ${userId}
			and not (
				'admin' = any(string_to_array(coalesce("user".role, ''), ','))
			)
	`);

	return result.rows[0] ?? null;
}

export async function stageMemberPasswordReset(database: Database, userId: string) {
	const result = await database.execute<{ changed: boolean; userId: string }>(sql`
		with target_member as materialized (
			select member_permissions.user_id, member_permissions.temporary_password
			from member_permissions
			inner join "user" on "user".id = member_permissions.user_id
			where member_permissions.user_id = ${userId}
				and not (
					'admin' = any(string_to_array(coalesce("user".role, ''), ','))
				)
			for update of member_permissions
		), staged_member as (
			update member_permissions
			set temporary_password = true, updated_at = now()
			from target_member
			where member_permissions.user_id = target_member.user_id
				and target_member.temporary_password = false
			returning member_permissions.user_id
		)
		select
			target_member.user_id as "userId",
			target_member.temporary_password = false as changed
		from target_member
	`);

	return result.rows[0] ?? null;
}

export type ManagedMember = Awaited<ReturnType<typeof listMembers>>[number];
