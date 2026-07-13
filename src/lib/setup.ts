import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../db/client';
import { createInternalEmail } from './internal-email';
import { passwordHasher } from './password-hasher';
import { passwordValueSchema } from './password';

const setupClaimKey = 'owner';
const encoder = new TextEncoder();

export const setupInputSchema = z
	.object({
		setupSecret: z.string().min(1).max(4096),
		username: z
			.string()
			.trim()
			.min(3, 'Username must be at least 3 characters.')
			.max(30, 'Username must be at most 30 characters.')
			.regex(/^[a-zA-Z0-9_.]+$/, 'Use only letters, numbers, underscores, and periods.'),
		password: passwordValueSchema,
		confirmPassword: z.string(),
	})
	.refine(({ confirmPassword, password }) => confirmPassword === password, {
		message: 'Passwords do not match.',
		path: ['confirmPassword'],
	});

interface TimingSafeSubtleCrypto extends SubtleCrypto {
	timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
}

export async function verifySetupSecret(provided: string, expected: string) {
	const [providedHash, expectedHash] = await Promise.all([
		crypto.subtle.digest('SHA-256', encoder.encode(provided)),
		crypto.subtle.digest('SHA-256', encoder.encode(expected)),
	]);

	return (crypto.subtle as TimingSafeSubtleCrypto).timingSafeEqual(providedHash, expectedHash);
}

export async function isSetupAvailable(database: Database) {
	const result = await database.execute<{ available: boolean }>(sql`
		select not exists(select 1 from "user")
			and not exists(select 1 from setup_state where key = ${setupClaimKey})
			as available
	`);

	return result.rows[0]?.available === true;
}

export interface CreateOwnerInput {
	password: string;
	username: string;
}

export async function createOwner(database: Database, input: CreateOwnerInput) {
	const userId = crypto.randomUUID();
	const accountId = crypto.randomUUID();
	const email = createInternalEmail();
	const displayUsername = input.username;
	const username = displayUsername.toLowerCase();
	const passwordHash = await passwordHasher.hash(input.password);

	// The setup claim and all owner records are one statement so concurrent requests
	// cannot create multiple owners and a partial setup is always rolled back.
	const result = await database.execute<{ userId: string }>(sql`
		with claimed as (
			insert into setup_state (key)
			select ${setupClaimKey}
			where not exists(select 1 from "user")
			on conflict (key) do nothing
			returning key
		), created_user as (
			insert into "user" (
				id,
				name,
				email,
				email_verified,
				username,
				display_username,
				role,
				banned
			)
			select
				${userId},
				${displayUsername},
				${email},
				false,
				${username},
				${displayUsername},
				'admin',
				false
			from claimed
			returning id
		), created_account as (
			insert into account (id, account_id, provider_id, user_id, password)
			select ${accountId}, id, 'credential', id, ${passwordHash}
			from created_user
			returning user_id
		)
		insert into member_permissions (user_id, temporary_password)
		select user_id, false
		from created_account
		returning user_id as "userId"
	`);

	return result.rows[0]?.userId ?? null;
}
