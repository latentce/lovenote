import cloudflareCacheProvider from '@astrojs/cloudflare/cache/provider';
import type { CacheProviderFactory } from 'astro';
import { collectInvalidationTags } from 'astro/cache/provider-utils';

export class CloudflareCachePurgeError extends Error {
	constructor(readonly errors: CachePurgeError[]) {
		const details = errors.map(({ code, message }) => `${code}: ${message}`).join('; ');
		super(details ? `Cloudflare cache purge failed: ${details}` : 'Cloudflare cache purge failed.');
		this.name = 'CloudflareCachePurgeError';
	}
}

export function assertSuccessfulCachePurge(result: CachePurgeResult) {
	if (!result.success) throw new CloudflareCachePurgeError(result.errors);
}

const factory: CacheProviderFactory = (config) => {
	const provider = cloudflareCacheProvider(config);

	return {
		...provider,
		async invalidate(options) {
			const tags = collectInvalidationTags(options);
			if (tags.length === 0) return;

			const { cache } = await import('cloudflare:workers');
			assertSuccessfulCachePurge(await cache.purge({ tags }));
		},
	};
};

export default factory;
