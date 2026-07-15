import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import {
	canCacheMediaRequest,
	evaluateMediaPreconditions,
	httpEtag,
	ifRangeAllowsRange,
	parseMediaRange,
} from '../../src/lib/media-delivery';

describe('media delivery in the Workers runtime', () => {
	it('uses Workers Request and Headers for cache and conditional semantics', () => {
		const media = { status: 'active' as const, visibility: 'public' as const };
		const updatedAt = new Date('2026-07-15T00:00:00.000Z');
		const etag = httpEtag('worker-etag');

		expect(canCacheMediaRequest(media, new Request('https://example.test/media'), false)).toBe(true);
		expect(
			canCacheMediaRequest(
				media,
				new Request('https://example.test/media', { headers: { Range: 'bytes=0-3' } }),
				false,
			),
		).toBe(false);
		expect(
			evaluateMediaPreconditions(new Headers({ 'If-None-Match': etag }), etag, updatedAt),
		).toBe('not-modified');
		expect(ifRangeAllowsRange(etag, etag, updatedAt)).toBe(true);
		expect(parseMediaRange('bytes=-4', 10)).toEqual({ kind: 'range', length: 4, offset: 6 });
	});

	it('can round-trip bytes through the locally emulated R2 binding', async () => {
		const key = `worker-test/${crypto.randomUUID()}`;
		const bytes = new Uint8Array([0, 1, 2, 3, 255]);

		await env.MEDIA_BUCKET.put(key, bytes, {
			httpMetadata: { contentType: 'application/octet-stream' },
		});
		const object = await env.MEDIA_BUCKET.get(key);

		expect(object).not.toBeNull();
		expect(Array.from(new Uint8Array(await object!.arrayBuffer()))).toEqual(Array.from(bytes));
		expect(object!.httpMetadata?.contentType).toBe('application/octet-stream');

		await env.MEDIA_BUCKET.delete(key);
		expect(await env.MEDIA_BUCKET.head(key)).toBeNull();
	});

	it('provides Web Crypto primitives used by request authentication', async () => {
		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('lovenote'));
		expect(new Uint8Array(digest)).toHaveLength(32);
		expect(crypto.randomUUID()).toMatch(/^[0-9a-f-]{36}$/u);
	});
});
