import { eq } from 'drizzle-orm';
import { ActionError, defineAction } from 'astro:actions';
import { isAPIError } from 'better-auth/api';

import { memberPermissions } from '../db/schema';
import { AuthorizationError, requireMember } from '../lib/authorization';
import { changePasswordInputSchema } from '../lib/password';

export const account = {
	changePassword: defineAction({
		accept: 'form',
		input: changePasswordInputSchema,
		handler: async (
			{ confirmPassword: _confirmPassword, currentPassword, newPassword },
			{ locals, request },
		) => {
			let user;

			try {
				user = requireMember(locals);
			} catch (error) {
				if (error instanceof AuthorizationError) {
					throw new ActionError({
						code: 'UNAUTHORIZED',
						message: 'Sign in to change your password.',
					});
				}

				throw error;
			}

			try {
				await locals.auth.api.changePassword({
					body: {
						currentPassword,
						newPassword,
						revokeOtherSessions: false,
					},
					headers: request.headers,
				});
			} catch (error) {
				if (isAPIError(error)) {
					const code = typeof error.body?.code === 'string' ? error.body.code : error.status;
					console.warn(JSON.stringify({ event: 'account.password_change_rejected', code, userId: user.id }));

					if (error.body?.code === 'INVALID_PASSWORD') {
						throw new ActionError({
							code: 'UNAUTHORIZED',
							message: 'The current password is incorrect.',
						});
					}

					if (error.status === 'UNAUTHORIZED') {
						throw new ActionError({
							code: 'UNAUTHORIZED',
							message: 'Your session has expired. Sign in again.',
						});
					}
				}

				throw new ActionError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'The password could not be changed. Please try again.',
				});
			}

			const updatedPermissions = await locals.database
				.update(memberPermissions)
				.set({
					temporaryPassword: false,
					updatedAt: new Date(),
				})
				.where(eq(memberPermissions.userId, user.id))
				.returning({ userId: memberPermissions.userId });

			if (!updatedPermissions[0]) {
				console.error(
					JSON.stringify({ event: 'account.permissions_missing', userId: user.id }),
				);
				throw new ActionError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'The account could not be updated. Contact the owner.',
				});
			}

			console.info(JSON.stringify({ event: 'account.password_changed', userId: user.id }));

			return { changed: true };
		},
	}),
};
