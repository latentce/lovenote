import { describe, expect, it } from 'vitest';

import type { PostLifecycleResult } from '../db/post-mutations';
import { postLifecycleCacheTags } from './cache-invalidation';

const publicPost: PostLifecycleResult = {
	changed: true,
	id: 42,
	media: [{ id: '3df91f2d-582c-4d2a-b24d-c42d2ed58f7d', previousRevision: 3 }],
	tagIds: [2, 7],
	visibility: 'public',
};

describe('post lifecycle cache invalidation', () => {
	it('purges every public listing, tag archive, detail, and old media revision when hiding', () => {
		expect(postLifecycleCacheTags(publicPost, 'hidden')).toEqual([
			'post:42',
			'feed',
			'archive',
			'tags',
			'tag:2',
			'tag:7',
			'media:3df91f2d-582c-4d2a-b24d-c42d2ed58f7d:3',
		]);
	});

	it('does not purge public indexes for a private post', () => {
		expect(
			postLifecycleCacheTags({ ...publicPost, media: [], visibility: 'private' }, 'active'),
		).toEqual(['post:42']);
	});

	it('does not purge the current media revision when restoring', () => {
		expect(postLifecycleCacheTags(publicPost, 'active')).not.toContain(
			'media:3df91f2d-582c-4d2a-b24d-c42d2ed58f7d:3',
		);
	});
});
