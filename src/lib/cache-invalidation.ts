import type { PostLifecycleResult } from '../db/post-mutations';
import type { PostStatus } from './post';

export function postLifecycleCacheTags(
	post: PostLifecycleResult,
	nextStatus: Extract<PostStatus, 'active' | 'hidden'>,
) {
	const tags = new Set([`post:${post.id}`]);

	if (post.visibility === 'public') {
		tags.add('feed');
		tags.add('archive');
		tags.add('tags');
		for (const tagId of post.tagIds) tags.add(`tag:${tagId}`);
	}

	if (nextStatus === 'hidden') {
		for (const media of post.media) {
			tags.add(`media:${media.id}:${media.previousRevision}`);
		}
	}

	return [...tags];
}
