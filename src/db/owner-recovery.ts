import { sql } from 'drizzle-orm';

import type { Database } from './client';

export type OwnerRecoveryResult = {
	sessionsRevoked: number;
	userId: string;
};

export async function recoverOwnerPassword(database: Database, passwordHash: string) {
	const result = await database.execute<OwnerRecoveryResult>(sql`
		with eligible_owner as materialized (
			select "user".id
			from "user"
			where 'admin' = any(string_to_array(coalesce("user".role, ''), ','))
		), sole_owner as (
			select min(eligible_owner.id) as id
			from eligible_owner
			having count(*) = 1
		), updated_account as (
			update account
			set password = ${passwordHash}, updated_at = now()
			from sole_owner
			where account.user_id = sole_owner.id
				and account.provider_id = 'credential'
			returning account.user_id
		), revoked_sessions as (
			delete from session
			using updated_account
			where session.user_id = updated_account.user_id
			returning session.id
		)
		select
			updated_account.user_id as "userId",
			(select count(*)::integer from revoked_sessions) as "sessionsRevoked"
		from updated_account
	`);

	return result.rows[0] ?? null;
}
