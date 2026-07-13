import type { PostLifecycleResult } from '../db/post-mutations';
import type { StagedPostDeletion } from '../db/post-deletion-mutations';
import type { PostEditResult } from '../db/post-edit-mutations';
import type { PostStatus } from './post';

export function postCreationCacheTags(tagIds: number[], visibility: 'public' | 'private') {
	if (visibility === 'private') return [];

	return [
		'feed',
		'archive',
		'tags',
		...tagIds.map((tagId) => `tag:${tagId}`),
	];
}

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

export function postDeletionCacheTags(post: StagedPostDeletion) {
	const tags = new Set([`post:${post.id}`]);

	if (post.visibility === 'public') {
		tags.add('feed');
		tags.add('archive');
		tags.add('tags');
		for (const tagId of post.tagIds) tags.add(`tag:${tagId}`);
	}

	for (const media of post.media) {
		tags.add(`media:${media.id}:${media.previousRevision}`);
	}

	return [...tags];
}

export function postEditCacheTags(post: PostEditResult, purgePublic = false) {
	const tags = new Set([`post:${post.id}`]);

	if (purgePublic || post.previousVisibility === 'public' || post.visibility === 'public') {
		tags.add('feed');
		tags.add('archive');
		tags.add('tags');
		for (const tagId of post.tagIds) tags.add(`tag:${tagId}`);
	}

	for (const media of post.media) {
		tags.add(`media:${media.id}:${media.previousRevision}`);
	}

	return [...tags];
}
