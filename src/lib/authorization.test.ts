import { describe, expect, it } from 'vitest';

import type { AuthenticatedUser } from './auth';
import {
	AuthorizationError,
	canViewPrivateContent,
	hasCapability,
	isOwner,
	requireCapability,
	requireMember,
	requireOwner,
	type MemberPermissions,
} from './authorization';

const member = {
	id: 'member-id',
	name: 'Member',
	email: 'member@users.invalid',
	emailVerified: false,
	username: 'member',
	displayUsername: 'Member',
	role: 'user',
	banned: false,
} as AuthenticatedUser;

const owner = {
	...member,
	id: 'owner-id',
	username: 'owner',
	role: 'admin',
} as AuthenticatedUser;

const permissions = {
	userId: member.id,
	createPosts: true,
	editOwnPosts: true,
	hideOwnPosts: true,
	deleteOwnPosts: true,
	uploadImages: true,
	uploadVideos: false,
	createComments: true,
	favoritePosts: true,
	manageTags: false,
	moderateComments: false,
	temporaryPassword: false,
	createdAt: new Date(),
	updatedAt: new Date(),
} satisfies MemberPermissions;

describe('authorization', () => {
	it('lets every active member view private content', () => {
		expect(canViewPrivateContent(member)).toBe(true);
		expect(canViewPrivateContent({ ...member, banned: true })).toBe(false);
		expect(canViewPrivateContent(null)).toBe(false);
	});

	it('gives an active owner every capability without a permission row', () => {
		expect(isOwner(owner)).toBe(true);
		expect(hasCapability({ user: owner, permissions: null }, 'moderateComments')).toBe(true);
		expect(hasCapability({ user: { ...owner, banned: true }, permissions: null }, 'createPosts')).toBe(
			false,
		);
	});

	it('uses current member capability values', () => {
		expect(hasCapability({ user: member, permissions }, 'createPosts')).toBe(true);
		expect(hasCapability({ user: member, permissions }, 'uploadVideos')).toBe(false);
		expect(hasCapability({ user: member, permissions: null }, 'createPosts')).toBe(false);
	});

	it('blocks capabilities until a temporary password is changed', () => {
		const context = {
			user: member,
			permissions: { ...permissions, temporaryPassword: true },
		};

		expect(hasCapability(context, 'createPosts')).toBe(false);
		expect(() => requireCapability(context, 'createPosts')).toThrow(
			expect.objectContaining<Partial<AuthorizationError>>({
				code: 'PASSWORD_CHANGE_REQUIRED',
				status: 403,
			}),
		);
	});

	it('distinguishes unauthenticated, member, and owner requirements', () => {
		expect(() => requireMember({ user: null, permissions: null })).toThrow(
			expect.objectContaining<Partial<AuthorizationError>>({
				code: 'AUTHENTICATION_REQUIRED',
				status: 401,
			}),
		);
		expect(() => requireOwner({ user: member, permissions })).toThrow(
			expect.objectContaining<Partial<AuthorizationError>>({
				code: 'OWNER_REQUIRED',
				status: 403,
			}),
		);
		expect(requireOwner({ user: owner, permissions: null })).toBe(owner);
	});
});
