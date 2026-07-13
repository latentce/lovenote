import { z } from 'zod';

export const MAX_MEMBER_ACCOUNTS = 5;

const formCheckboxSchema = z.preprocess(
	(value) => value === true || value === 'on',
	z.boolean(),
);

export const createMemberInputSchema = z
	.object({
		username: z
			.string()
			.trim()
			.min(3, 'Username must be at least 3 characters.')
			.max(30, 'Username must be at most 30 characters.')
			.regex(/^[a-zA-Z0-9_.]+$/, 'Use only letters, numbers, underscores, and periods.'),
		password: z
			.string()
			.min(12, 'Password must be at least 12 characters.')
			.max(128, 'Password must be at most 128 characters.'),
		confirmPassword: z.string(),
		createPosts: formCheckboxSchema,
		editOwnPosts: formCheckboxSchema,
		hideOwnPosts: formCheckboxSchema,
		deleteOwnPosts: formCheckboxSchema,
		uploadImages: formCheckboxSchema,
		uploadVideos: formCheckboxSchema,
		createComments: formCheckboxSchema,
		favoritePosts: formCheckboxSchema,
		manageTags: formCheckboxSchema,
		moderateComments: formCheckboxSchema,
	})
	.refine(({ confirmPassword, password }) => confirmPassword === password, {
		message: 'Passwords do not match.',
		path: ['confirmPassword'],
	});

export type CreateMemberInput = z.infer<typeof createMemberInputSchema>;
export type NewMemberPermissions = Omit<
	CreateMemberInput,
	'confirmPassword' | 'password' | 'username'
>;
