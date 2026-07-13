import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../db/client';
import type { Auth, AuthSessionResult } from './auth';
import { hasCapability, type MemberPermissions } from './authorization';
import { loadRequestAuthorization } from './request-authorization';

const member = {
	banned: false,
	displayUsername: 'Member',
	email: 'member@users.invalid',
	emailVerified: false,
	id: 'member-id',
	name: 'Member',
	role: 'user',
	username: 'member',
};

const session = {
	createdAt: new Date('2026-07-13T18:00:00.000Z'),
	expiresAt: new Date('2026-07-20T18:00:00.000Z'),
	id: 'session-id',
	token: 'session-token',
	updatedAt: new Date('2026-07-13T18:00:00.000Z'),
	userId: member.id,
};

const permissions = {
	createComments: true,
	createPosts: true,
	createdAt: new Date('2026-07-13T18:00:00.000Z'),
	deleteOwnPosts: true,
	editOwnPosts: true,
	favoritePosts: true,
	hideOwnPosts: true,
	manageTags: false,
	moderateComments: false,
	temporaryPassword: false,
	updatedAt: new Date('2026-07-13T18:00:00.000Z'),
	uploadImages: true,
	uploadVideos: true,
	userId: member.id,
} satisfies MemberPermissions;

function authReturning(result: AuthSessionResult) {
	return {
		api: { getSession: vi.fn().mockResolvedValue(result) },
	} as unknown as Pick<Auth, 'api'>;
}

function databaseReturning(...results: Array<MemberPermissions | undefined>) {
	const findFirst = vi.fn();
	for (const result of results) findFirst.mockResolvedValueOnce(result);

	return {
		database: {
			query: { memberPermissions: { findFirst } },
		} as unknown as Database,
		findFirst,
	};
}

describe('request authorization loading', () => {
	it('reloads capabilities on every request so revocation takes effect immediately', async () => {
		const auth = authReturning({ session, user: member } as AuthSessionResult);
		const { database, findFirst } = databaseReturning(permissions, {
			...permissions,
			createPosts: false,
		});

		const firstRequest = await loadRequestAuthorization(auth, database, new Headers());
		const secondRequest = await loadRequestAuthorization(auth, database, new Headers());

		expect(hasCapability(firstRequest, 'createPosts')).toBe(true);
		expect(hasCapability(secondRequest, 'createPosts')).toBe(false);
		expect(findFirst).toHaveBeenCalledTimes(2);
	});

	it('does not expose a banned session or load its permission record', async () => {
		const auth = authReturning({
			session,
			user: { ...member, banned: true },
		} as AuthSessionResult);
		const { database, findFirst } = databaseReturning(permissions);

		await expect(loadRequestAuthorization(auth, database, new Headers())).resolves.toEqual({
			permissions: null,
			session: null,
			user: null,
		});
		expect(findFirst).not.toHaveBeenCalled();
	});
});
