import { describe, expect, it } from 'vitest';

import { createMemberInputSchema, MAX_MEMBER_ACCOUNTS } from './member';

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
});
