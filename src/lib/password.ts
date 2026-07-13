import { z } from 'zod';

export const changePasswordInputSchema = z
	.object({
		currentPassword: z.string().min(1, 'Enter your current password.').max(128),
		newPassword: z
			.string()
			.min(12, 'Password must be at least 12 characters.')
			.max(128, 'Password must be at most 128 characters.'),
		confirmPassword: z.string(),
	})
	.refine(({ confirmPassword, newPassword }) => confirmPassword === newPassword, {
		message: 'Passwords do not match.',
		path: ['confirmPassword'],
	})
	.refine(({ currentPassword, newPassword }) => currentPassword !== newPassword, {
		message: 'Choose a password different from your current password.',
		path: ['newPassword'],
	});
