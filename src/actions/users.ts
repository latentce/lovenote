import { eq } from 'drizzle-orm';
import { ActionError, defineAction } from 'astro:actions';
import { isAPIError } from 'better-auth/api';

import { user } from '../db/auth-schema';
import {
	addMemberPermissions,
	countMembers,
	findManageableMember,
	stageMemberPasswordReset,
	updateMemberPermissions,
} from '../db/member-admin';
import type { Auth } from '../lib/auth';
import { AuthorizationError, requireOwner } from '../lib/authorization';
import { createInternalEmail } from '../lib/internal-email';
import {
	banMemberInputSchema,
	createMemberInputSchema,
	MAX_MEMBER_ACCOUNTS,
	memberStatusInputSchema,
	type NewMemberPermissions,
	resetMemberPasswordInputSchema,
	revokeMemberSessionsInputSchema,
	updateMemberPermissionsInputSchema,
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

async function changeMemberBanStatus(
	locals: App.Locals,
	requestHeaders: Headers,
	userId: string,
	banned: boolean,
) {
	const owner = authorizeUserManagement(locals);
	const member = await findManageableMember(locals.database, userId);
	if (!member) {
		throw new ActionError({
			code: 'NOT_FOUND',
			message: 'This member is unavailable or cannot have owner access changed.',
		});
	}

	const changed = (member.banned === true) !== banned;
	if (!changed && !banned) {
		return { banned, changed: false, userId: member.id };
	}

	try {
		if (banned) {
			await locals.auth.api.banUser({
				body: {
					banReason: 'Disabled by the LoveNote owner.',
					userId: member.id,
				},
				headers: requestHeaders,
			});
		} else {
			await locals.auth.api.unbanUser({
				body: { userId: member.id },
				headers: requestHeaders,
			});
		}
	} catch (error) {
		if (isAPIError(error)) {
			const code = typeof error.body?.code === 'string' ? error.body.code : error.status;
			console.warn(
				JSON.stringify({
					code,
					event: 'owner.member_status_rejected',
					ownerId: owner.id,
					userId: member.id,
				}),
			);

			if (error.status === 'UNAUTHORIZED') {
				throw new ActionError({
					code: 'UNAUTHORIZED',
					message: 'Your owner session has expired. Sign in again.',
				});
			}
			if (error.status === 'FORBIDDEN') {
				throw new ActionError({
					code: 'FORBIDDEN',
					message: 'The account status change was not allowed.',
				});
			}
		}

		throw new ActionError({
			code: 'INTERNAL_SERVER_ERROR',
			message: 'The account status could not be changed. Please try again.',
		});
	}

	console.info(
		JSON.stringify({
			changed,
			event: banned ? 'owner.member_banned' : 'owner.member_unbanned',
			ownerId: owner.id,
			userId: member.id,
		}),
	);
	return { banned, changed, userId: member.id };
}

function authErrorCode(error: unknown) {
	if (!isAPIError(error)) return null;
	return typeof error.body?.code === 'string' ? error.body.code : error.status;
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
	updatePermissions: defineAction({
		accept: 'form',
		input: updateMemberPermissionsInputSchema,
		handler: async (input, { locals }) => {
			const owner = authorizeUserManagement(locals);
			const updatedUserId = await updateMemberPermissions(locals.database, input);

			if (!updatedUserId) {
				throw new ActionError({
					code: 'NOT_FOUND',
					message: 'This member is unavailable or cannot have owner capabilities changed.',
				});
			}

			console.info(
				JSON.stringify({
					enabledCapabilityCount: Object.values(input).filter((value) => value === true).length,
					event: 'owner.member_permissions_updated',
					ownerId: owner.id,
					userId: updatedUserId,
				}),
			);

			return { updated: true, userId: updatedUserId };
		},
	}),
	ban: defineAction({
		accept: 'form',
		input: banMemberInputSchema,
		handler: (input, { locals, request }) =>
			changeMemberBanStatus(locals, request.headers, input.userId, true),
	}),
	unban: defineAction({
		accept: 'form',
		input: memberStatusInputSchema,
		handler: (input, { locals, request }) =>
			changeMemberBanStatus(locals, request.headers, input.userId, false),
	}),
	revokeSessions: defineAction({
		accept: 'form',
		input: revokeMemberSessionsInputSchema,
		handler: async (input, { locals, request }) => {
			const owner = authorizeUserManagement(locals);
			const member = await findManageableMember(locals.database, input.userId);
			if (!member) {
				throw new ActionError({
					code: 'NOT_FOUND',
					message: 'This member is unavailable or cannot have owner sessions revoked.',
				});
			}

			try {
				await locals.auth.api.revokeUserSessions({
					body: { userId: member.id },
					headers: request.headers,
				});
			} catch (error) {
				console.warn(
					JSON.stringify({
						code: authErrorCode(error),
						event: 'owner.member_session_revoke_rejected',
						ownerId: owner.id,
						userId: member.id,
					}),
				);

				if (isAPIError(error) && error.status === 'UNAUTHORIZED') {
					throw new ActionError({
						code: 'UNAUTHORIZED',
						message: 'Your owner session has expired. Sign in again.',
					});
				}
				if (isAPIError(error) && error.status === 'FORBIDDEN') {
					throw new ActionError({
						code: 'FORBIDDEN',
						message: 'The session revocation was not allowed.',
					});
				}

				throw new ActionError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'The member sessions could not be revoked. Please try again.',
				});
			}

			console.info(
				JSON.stringify({
					event: 'owner.member_sessions_revoked',
					ownerId: owner.id,
					userId: member.id,
				}),
			);

			return { revoked: true, userId: member.id };
		},
	}),
	resetPassword: defineAction({
		accept: 'form',
		input: resetMemberPasswordInputSchema,
		handler: async (input, { locals, request }) => {
			const owner = authorizeUserManagement(locals);
			const staged = await stageMemberPasswordReset(locals.database, input.userId);
			if (!staged) {
				throw new ActionError({
					code: 'NOT_FOUND',
					message: 'This member is unavailable or cannot have the owner password reset.',
				});
			}

			try {
				await locals.auth.api.revokeUserSessions({
					body: { userId: staged.userId },
					headers: request.headers,
				});
			} catch (error) {
				console.error(
					JSON.stringify({
						code: authErrorCode(error),
						event: 'owner.member_password_reset_failed',
						phase: 'initial_session_revoke',
						userId: staged.userId,
					}),
				);
				throw new ActionError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'Sessions could not be revoked, so the password was not changed. Try again.',
				});
			}

			try {
				await locals.auth.api.setUserPassword({
					body: {
						newPassword: input.newPassword,
						userId: staged.userId,
					},
					headers: request.headers,
				});
			} catch (error) {
				console.error(
					JSON.stringify({
						code: authErrorCode(error),
						event: 'owner.member_password_reset_failed',
						phase: 'password_change',
						userId: staged.userId,
					}),
				);
				throw new ActionError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'The password could not be reset. Existing sessions were revoked; try again.',
				});
			}

			let sessionsRevoked = true;
			let accountBanned = false;
			try {
				await locals.auth.api.revokeUserSessions({
					body: { userId: staged.userId },
					headers: request.headers,
				});
			} catch (error) {
				sessionsRevoked = false;
				console.error(
					JSON.stringify({
						code: authErrorCode(error),
						event: 'owner.member_password_reset_failed',
						phase: 'final_session_revoke',
						userId: staged.userId,
					}),
				);

				try {
					await locals.auth.api.banUser({
						body: {
							banReason: 'Password reset session cleanup did not complete.',
							userId: staged.userId,
						},
						headers: request.headers,
					});
					accountBanned = true;
				} catch (banError) {
					console.error(
						JSON.stringify({
							code: authErrorCode(banError),
							event: 'owner.member_password_reset_ban_failed',
							userId: staged.userId,
						}),
					);
				}
			}

			console.info(
				JSON.stringify({
					accountBanned,
					event: 'owner.member_password_reset',
					ownerId: owner.id,
					sessionsRevoked,
					userId: staged.userId,
				}),
			);

			return {
				accountBanned,
				reset: true,
				sessionsRevoked,
				userId: staged.userId,
			};
		},
	}),
};
