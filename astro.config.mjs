// @ts-check
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, memoryCache } from 'astro/config';

const acceptanceRuntime = process.env.LOVENOTE_ACCEPTANCE === '1';

// https://astro.build/config
export default defineConfig({
	output: 'server',
	adapter: cloudflare({
		imageService: 'compile',
	}),
	cache: {
		provider: acceptanceRuntime ? memoryCache() : {
			name: 'cloudflare',
			entrypoint: new URL('./src/lib/cloudflare-cache-provider.ts', import.meta.url),
		},
	},
	markdown: {
		syntaxHighlight: false,
	},
	routeRules: {
		'/': { maxAge: 60, swr: 300, tags: ['feed'] },
		'/archive': { maxAge: 60, swr: 300, tags: ['archive'] },
		'/posts/[id]': { maxAge: 60, swr: 300 },
		'/tags': { maxAge: 60, swr: 300, tags: ['tags'] },
		'/tags/[slug]': { maxAge: 60, swr: 300 },
	},
	security: {
		checkOrigin: true,
		actionBodySizeLimit: 128 * 1024,
		serverIslandBodySizeLimit: 64 * 1024,
		csp: {
			directives: [
				"default-src 'self'",
				"base-uri 'self'",
				"connect-src 'self' https://*.r2.cloudflarestorage.com",
				"font-src 'self'",
				"form-action 'self'",
				"frame-ancestors 'none'",
				"img-src 'self' data: blob:",
				"media-src 'self' blob:",
				"object-src 'none'",
			],
			scriptDirective: {
				resources: ["'self'"],
			},
			styleDirective: {
				resources: ["'self'"],
			},
		},
	},
	vite: {
		optimizeDeps: {
			include: ['astro/actions/runtime/entrypoints/route.js'],
		},
		plugins: [tailwindcss()],
	},
});
