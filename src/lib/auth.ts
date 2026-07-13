import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth/minimal';
import { admin } from 'better-auth/plugins/admin';

import { schema, type Database } from '../db/client';

export interface CreateAuthOptions {
	baseURL: string;
	database: Database;
	secret: string;
}

export function createAuth({ baseURL, database, secret }: CreateAuthOptions) {
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
			disableSignUp: true,
			requireEmailVerification: false,
			minPasswordLength: 12,
			maxPasswordLength: 128,
		},
		trustedOrigins: [baseURL],
		rateLimit: {
			enabled: true,
			storage: 'database',
		},
		advanced: {
			useSecureCookies: new URL(baseURL).protocol === 'https:',
		},
		plugins: [
			admin({
				defaultRole: 'user',
				adminRoles: ['admin'],
			}),
		],
	});
}

export type Auth = ReturnType<typeof createAuth>;
