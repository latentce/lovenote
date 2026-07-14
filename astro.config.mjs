// @ts-check
import cloudflare from '@astrojs/cloudflare';
import { cacheCloudflare } from '@astrojs/cloudflare/cache';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	output: 'server',
	adapter: cloudflare({
		imageService: 'compile',
	}),
	cache: {
		provider: cacheCloudflare(),
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
		plugins: [tailwindcss()],
	},
});
