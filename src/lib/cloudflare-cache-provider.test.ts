import { describe, expect, it } from 'vitest';

import {
	assertSuccessfulCachePurge,
	CloudflareCachePurgeError,
} from './cloudflare-cache-provider';

describe('Cloudflare cache provider', () => {
	it('accepts a successful purge result', () => {
		expect(() => assertSuccessfulCachePurge({ errors: [], success: true })).not.toThrow();
	});

	it('converts an unsuccessful purge result into an exception', () => {
		const result = {
			errors: [{ code: 1000, message: 'Unable to purge cache tags' }],
			success: false,
		};

		expect(() => assertSuccessfulCachePurge(result)).toThrow(CloudflareCachePurgeError);
		expect(() => assertSuccessfulCachePurge(result)).toThrow(/1000: Unable to purge cache tags/u);
	});
});
