import { sql } from 'drizzle-orm';

export function requestedTagIdsQuery(tagIds: number[]) {
	if (tagIds.length === 0) {
		return sql`
			select null::integer as id
			where false
		`;
	}

	const ids = sql.join(
		tagIds.map((id) => sql`${id}::integer`),
		sql`, `,
	);

	return sql`
		select distinct requested.id
		from unnest(array[${ids}]) as requested(id)
	`;
}
