import { describe, expect, it } from 'vitest';

import {
	banMemberInputSchema,
	createMemberInputSchema,
	MAX_MEMBER_ACCOUNTS,
	memberStatusInputSchema,
	updateMemberPermissionsInputSchema,
} from './member';

const validMember = {
	confirmPassword: 'temporary-password',
	password: 'temporary-password',
	username: 'New.Member',
};

describe('member creation input', () => {
	it('normalizes the username and parses standard form checkboxes', () => {
		expect(
			createMemberInputSchema.parse({
				...validMember,
				createPosts: 'on',
				manageTags: 'on',
			}),
		).toMatchObject({
			createPosts: true,
				manageTags: true,
				moderateComments: false,
				uploadVideos: false,
				username: 'New.Member',
		});
	});

	it.each(['ab', 'member name', 'member-name', 'member@example'])('rejects username %s', (username) => {
		expect(createMemberInputSchema.safeParse({ ...validMember, username }).success).toBe(false);
	});

	it('requires a 12-character matching temporary password', () => {
		expect(
			createMemberInputSchema.safeParse({
				...validMember,
				confirmPassword: 'different-password',
			}).success,
		).toBe(false);
		expect(
			createMemberInputSchema.safeParse({
				...validMember,
				confirmPassword: 'short',
				password: 'short',
			}).success,
		).toBe(false);
	});

	it('caps the closed group at five accounts', () => {
		expect(MAX_MEMBER_ACCOUNTS).toBe(5);
	});

	it('parses a complete capability replacement from an HTML form', () => {
		expect(
			updateMemberPermissionsInputSchema.parse({
				createComments: 'on',
				manageTags: 'on',
				userId: 'member-id',
			}),
		).toMatchObject({
			createComments: true,
			createPosts: false,
			manageTags: true,
			moderateComments: false,
			userId: 'member-id',
		});
	});

	it('requires explicit confirmation to ban but not to unban a member', () => {
		expect(banMemberInputSchema.safeParse({ userId: 'member-id' }).success).toBe(false);
		expect(
			banMemberInputSchema.parse({ confirmation: 'ban', userId: 'member-id' }),
		).toEqual({ confirmation: 'ban', userId: 'member-id' });
		expect(memberStatusInputSchema.parse({ userId: 'member-id' })).toEqual({
			userId: 'member-id',
		});
	});
});
