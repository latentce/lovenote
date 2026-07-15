import { expect, test } from '@playwright/test';

test.use({ javaScriptEnabled: false });

const publicRoutes = [
	{ heading: 'Shared moments', path: '/' },
	{ heading: 'Photographs and videos', path: '/archive' },
	{ heading: 'Browse by topic', path: '/tags' },
] as const;

test.describe('anonymous public browsing without JavaScript', () => {
	for (const route of publicRoutes) {
		test(`${route.path} renders public content`, async ({ page }) => {
			const response = await page.goto(route.path);

			expect(response?.ok()).toBe(true);
			await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
			await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
		});
	}

	test('public pages carry the runtime security policy', async ({ page }) => {
		const response = await page.goto('/');

		expect(response?.headers()['content-security-policy']).toContain("default-src 'self'");
		expect(response?.headers()['cross-origin-opener-policy']).toBe('same-origin');
		expect(response?.headers()['cross-origin-resource-policy']).toBe('same-origin');
		expect(response?.headers()['permissions-policy']).toContain('geolocation=()');
		expect(response?.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
		expect(response?.headers()['strict-transport-security']).toBe('max-age=31536000');
		expect(response?.headers()['x-content-type-options']).toBe('nosniff');
		expect(response?.headers()['x-frame-options']).toBe('DENY');
	});

	test('invalid cursors return to the canonical archive', async ({ page }) => {
		await page.goto('/archive?cursor=not-a-valid-cursor');

		expect(new URL(page.url()).pathname).toBe('/archive');
		expect(new URL(page.url()).search).toBe('');
		await expect(page.getByRole('heading', { level: 1, name: 'Photographs and videos' })).toBeVisible();
	});
});

test.describe('anonymous access controls', () => {
	for (const path of ['/account', '/manage', '/private', '/owner/comments', '/owner/posts', '/owner/tags', '/owner/users']) {
		test(`${path} redirects to sign in`, async ({ request }) => {
			const response = await request.get(path, { maxRedirects: 0 });

			expect([301, 302, 303, 307, 308]).toContain(response.status());
			expect(new URL(response.headers().location!, 'http://lovenote.invalid').pathname).toBe('/login');
		});
	}

	test('the login response is never shared or cached', async ({ request }) => {
		const response = await request.get('/login');

		expect(response.ok()).toBe(true);
		expect(response.headers()['cache-control']).toContain('private');
		expect(response.headers()['cache-control']).toContain('no-store');
	});

	test('malformed media identifiers reveal no metadata', async ({ request }) => {
		const response = await request.get('/media/not-an-asset/1/private-name.jpg');

		expect(response.status()).toBe(404);
		expect(response.headers()['cache-control']).toBe('private, no-store');
		expect(response.headers()['content-type']).toContain('text/plain');
		expect(await response.text()).toBe('Not found.');
	});

	test('public registration remains unavailable at the HTTP boundary', async ({ request }) => {
		const response = await request.post('/api/auth/sign-up/email', {
			data: {
				email: 'blocked@test.invalid',
				name: 'Blocked',
				password: 'not-a-real-password',
			},
		});
		expect(response.status()).toBe(404);
		expect(response.headers()['cache-control']).toContain('no-store');
	});
});
