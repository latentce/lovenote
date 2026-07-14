import { describe, expect, it } from 'vitest';

import {
	createTagInputSchema,
	MAX_POST_TAGS,
	mergeTagInputSchema,
	normalizeTagSlug,
	updateTagInputSchema,
} from './tag';

describe('tag inputs', () => {
	it('normalizes a URL-safe lowercase slug', () => {
		expect(normalizeTagSlug('  #Café & Good News!  ')).toBe('cafe-good-news');
		expect(
			createTagInputSchema.parse({
				description: ' A short description. ',
				displayName: ' Good News ',
				slug: ' #Good News ',
			}),
		).toEqual({
			description: 'A short description.',
			displayName: 'Good News',
			slug: 'good-news',
		});
	});

	it('accepts an empty Astro form textarea as an empty description', () => {
		expect(
			createTagInputSchema.parse({
				description: null,
				displayName: 'Good News',
				slug: 'good-news',
			}),
		).toEqual({ description: '', displayName: 'Good News', slug: 'good-news' });
	});

	it('enforces metadata limits and a non-empty slug', () => {
		expect(
			createTagInputSchema.safeParse({ description: '', displayName: '', slug: '' }).success,
		).toBe(false);
		expect(
			updateTagInputSchema.safeParse({
				description: 'x'.repeat(1_001),
				displayName: 'Tag',
				slug: 'tag',
				tagId: 1,
			}).success,
		).toBe(false);
		expect(MAX_POST_TAGS).toBe(30);
	});

	it('requires confirmation and distinct tags for a merge', () => {
		expect(
			mergeTagInputSchema.parse({
				confirmation: 'merge',
				sourceTagId: '1',
				targetTagId: '2',
			}),
		).toEqual({ confirmation: 'merge', sourceTagId: 1, targetTagId: 2 });
		expect(
			mergeTagInputSchema.safeParse({
				confirmation: 'merge',
				sourceTagId: 1,
				targetTagId: 1,
			}).success,
		).toBe(false);
	});
});
