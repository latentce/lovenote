import { expect, test } from '@playwright/test';

test('the login client runs under CSP and prevents credential query strings', async ({ page }) => {
	const cspErrors: string[] = [];
	await page.route('**/api/auth/**', (route) => route.abort());
	page.on('console', (message) => {
		if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
			cspErrors.push(message.text());
		}
	});

	const response = await page.goto('/login');
	expect(response?.ok()).toBe(true);

	const form = page.locator('[data-login-form]');
	await expect(form).toHaveAttribute('method', 'post');
	await expect(form).toHaveAttribute('action', '/login');

	const defaultPrevented = await form.evaluate((element) => {
		const event = new SubmitEvent('submit', { bubbles: true, cancelable: true });
		element.dispatchEvent(event);
		return event.defaultPrevented;
	});

	expect(defaultPrevented).toBe(true);
	expect(cspErrors).toEqual([]);
});
