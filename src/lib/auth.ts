import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth/minimal';
import { admin } from 'better-auth/plugins/admin';
import { username } from 'better-auth/plugins/username';

import { schema, type Database } from '../db/client';

export interface CreateAuthOptions {
	allowUserCreation?: boolean;
	baseURL: string;
	database: Database;
	secret: string;
}

export function createAuth({
	allowUserCreation = false,
	baseURL,
	database,
	secret,
}: CreateAuthOptions) {
	const disabledPaths = [
		'/change-email',
		'/is-username-available',
		'/request-password-reset',
		'/reset-password',
		'/send-verification-email',
		'/sign-in/email',
		'/verify-email',
	];

	if (!allowUserCreation) {
		disabledPaths.push('/sign-up/email');
	}

	return betterAuth({
		appName: 'LoveNote',
		baseURL,
		secret,
		database: drizzleAdapter(database, {
			provider: 'pg',
			schema,
		}),
		emailAndPassword: {
			enabled: true,
			disableSignUp: !allowUserCreation,
			requireEmailVerification: false,
			minPasswordLength: 12,
			maxPasswordLength: 128,
		},
		disabledPaths,
		trustedOrigins: [baseURL],
		rateLimit: {
			enabled: true,
			storage: 'database',
		},
		advanced: {
			useSecureCookies: new URL(baseURL).protocol === 'https:',
		},
		plugins: [
			username(),
			admin({
				defaultRole: 'user',
				adminRoles: ['admin'],
			}),
		],
	});
}

export type Auth = ReturnType<typeof createAuth>;
