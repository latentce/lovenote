import { sql } from 'drizzle-orm';

export function manageablePostAuthorFilter(actorId: string, owner: boolean) {
	return owner ? sql`true` : sql`posts.author_id = ${actorId}`;
}

export function visiblePostMutationFilter(actorId: string, owner: boolean) {
	if (owner) {
		return sql`posts.status <> 'deleting'`;
	}

	return sql`(
		posts.status = 'active'
		or (posts.status = 'hidden' and posts.author_id = ${actorId})
	)`;
}
