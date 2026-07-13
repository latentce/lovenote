import { eq } from 'drizzle-orm';

import type { Database } from '../db/client';
import { memberPermissions } from '../db/schema';
import type { Auth, AuthenticatedSession, AuthenticatedUser } from './auth';
import { isActiveMember, type MemberPermissions } from './authorization';

export interface RequestAuthorization {
	permissions: MemberPermissions | null;
	session: AuthenticatedSession | null;
	user: AuthenticatedUser | null;
}

export async function loadRequestAuthorization(
	auth: Pick<Auth, 'api'>,
	database: Database,
	headers: Headers,
): Promise<RequestAuthorization> {
	const sessionResult = await auth.api.getSession({ headers });

	if (!sessionResult || !isActiveMember(sessionResult.user)) {
		return { permissions: null, session: null, user: null };
	}

	const permissions = await database.query.memberPermissions.findFirst({
		where: eq(memberPermissions.userId, sessionResult.user.id),
	});

	return {
		permissions: permissions ?? null,
		session: sessionResult.session,
		user: sessionResult.user,
	};
}
