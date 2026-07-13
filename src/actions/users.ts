import { eq } from 'drizzle-orm';
import { ActionError, defineAction } from 'astro:actions';
import { isAPIError } from 'better-auth/api';

import { user } from '../db/auth-schema';
import { addMemberPermissions, countMembers } from '../db/member-admin';
import type { Auth } from '../lib/auth';
import { AuthorizationError, requireOwner } from '../lib/authorization';
import { createInternalEmail } from '../lib/internal-email';
import {
	createMemberInputSchema,
	MAX_MEMBER_ACCOUNTS,
	type NewMemberPermissions,
} from '../lib/member';

function authorizeUserManagement(locals: App.Locals) {
	try {
		return requireOwner(locals);
	} catch (error) {
		if (!(error instanceof AuthorizationError)) throw error;

		if (error.code === 'AUTHENTICATION_REQUIRED') {
			throw new ActionError({ code: 'UNAUTHORIZED', message: 'Sign in as the owner.' });
		}

		throw new ActionError({
			code: 'FORBIDDEN',
			message: 'Only the owner can manage member accounts.',
		});
	}
}

async function cleanUpIncompleteMember(
	auth: Auth,
	locals: App.Locals,
	requestHeaders: Headers,
	userId: string,
) {
	try {
		await auth.api.removeUser({
			body: { userId },
			headers: requestHeaders,
		});
		return true;
	} catch (error) {
		let accountDisabled = false;
		let disableErrorType: string | null = null;
		try {
			const banned = await locals.database
				.update(user)
				.set({
					banned: true,
					banReason: 'Account setup did not complete.',
					updatedAt: new Date(),
				})
				.where(eq(user.id, userId))
				.returning({ id: user.id });
			accountDisabled = Boolean(banned[0]);
		} catch (disableError) {
			disableErrorType = disableError instanceof Error ? disableError.name : 'UnknownError';
		}

		console.error(
			JSON.stringify({
				accountDisabled,
				disableErrorType,
				errorType: error instanceof Error ? error.name : 'UnknownError',
				event: 'owner.member_cleanup_failed',
				userId,
			}),
		);
		return accountDisabled;
	}
}

export const userActions = {
	create: defineAction({
		accept: 'form',
		input: createMemberInputSchema,
		handler: async (input, { locals, request }) => {
			const owner = authorizeUserManagement(locals);
			if ((await countMembers(locals.database)) >= MAX_MEMBER_ACCOUNTS) {
				throw new ActionError({
					code: 'CONFLICT',
					message: `LoveNote is limited to ${MAX_MEMBER_ACCOUNTS} accounts.`,
				});
			}

			const {
				confirmPassword: _confirmPassword,
				password,
				username,
				...permissions
			} = input;
			let userId: string;

			try {
				const created = await locals.auth.api.createUser({
					body: {
						data: {
							displayUsername: username,
							username: username.toLowerCase(),
						},
						email: createInternalEmail(),
						name: username,
						password,
						role: 'user',
					},
					headers: request.headers,
				});
				userId = created.user.id;
			} catch (error) {
				if (isAPIError(error)) {
					const code = typeof error.body?.code === 'string' ? error.body.code : error.status;
					console.warn(
						JSON.stringify({ code, event: 'owner.member_create_rejected', userId: owner.id }),
					);

					if (error.status === 'BAD_REQUEST' || String(code).includes('USERNAME')) {
						throw new ActionError({
							code: 'CONFLICT',
							message: 'That username is already in use or is not available.',
						});
					}
				}

				throw new ActionError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'The member account could not be created. Please try again.',
				});
			}

			let permissionsCreated: string | null;
			try {
				permissionsCreated = await addMemberPermissions(
					locals.database,
					userId,
					permissions as NewMemberPermissions,
				);
			} catch (error) {
				await cleanUpIncompleteMember(locals.auth, locals, request.headers, userId);
				console.error(
					JSON.stringify({
						errorType: error instanceof Error ? error.name : 'UnknownError',
						event: 'owner.member_permissions_failed',
						userId,
					}),
				);
				throw new ActionError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'The member account could not be initialized. Please try again.',
				});
			}

			if (!permissionsCreated) {
				await cleanUpIncompleteMember(locals.auth, locals, request.headers, userId);
				throw new ActionError({
					code: 'CONFLICT',
					message: `LoveNote is limited to ${MAX_MEMBER_ACCOUNTS} accounts.`,
				});
			}

			console.info(
				JSON.stringify({
					event: 'owner.member_created',
					ownerId: owner.id,
					userId,
				}),
			);
			return { created: true, userId, username };
		},
	}),
};
