import {
	expect,
	type Browser,
	type BrowserContext,
	type Page,
	test,
} from '@playwright/test';

const memberUsername = process.env.E2E_MEMBER_USERNAME;
const memberPassword = process.env.E2E_MEMBER_PASSWORD;
const ownerUsername = process.env.E2E_OWNER_USERNAME;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;
const mutationsEnabled = process.env.E2E_MUTATIONS === '1';
const uploadsEnabled = process.env.E2E_UPLOADS === '1';
type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

let memberState: StorageState | undefined;
let ownerState: StorageState | undefined;

async function authenticatedState(
	browser: Browser,
	baseURL: string,
	username: string,
	password: string,
) {
	const context = await browser.newContext({ baseURL });
	const page = await context.newPage();
	await page.goto('/login');
	await page.getByLabel('Username').fill(username);
	await page.getByLabel('Password').fill(password);
	await Promise.all([
		page.waitForURL('**/account'),
		page.getByRole('button', { name: 'Sign in' }).click(),
	]);
	const state = await context.storageState();
	await context.close();
	return state;
}

test.beforeAll(async ({ baseURL, browser }) => {
	if (memberUsername && memberPassword) {
		memberState = await authenticatedState(browser, baseURL!, memberUsername, memberPassword);
	}
	if (ownerUsername && ownerPassword) {
		ownerState = await authenticatedState(browser, baseURL!, ownerUsername, ownerPassword);
	}
});

async function deletePost(page: Page, body: string) {
	await page.goto('/manage');
	const item = page.locator('li').filter({ hasText: body }).first();
	await expect(item).toBeVisible();
	await item.locator('summary').click();
	await item.locator('input[name="confirmation"]').check();
	await Promise.all([
		page.waitForURL('**/manage'),
		item.getByRole('button', { name: 'Delete post permanently' }).click(),
	]);
	await expect(page.getByText(/was permanently deleted/)).toBeVisible();
}

test('an active member can browse private pages', async ({ baseURL, browser }) => {
	test.skip(!memberUsername || !memberPassword, 'Set dedicated E2E member credentials to run this test.');
	const context = await browser.newContext({ baseURL, storageState: memberState! });
	const page = await context.newPage();

	const response = await page.goto('/private');
	expect(response?.ok()).toBe(true);
	expect(response?.headers()['cache-control']).toContain('private');
	expect(response?.headers()['cache-control']).toContain('no-store');
	await expect(page.getByRole('heading', { level: 1, name: 'Private feed' })).toBeVisible();

	await context.close();
});

test('text post creation and deletion work without JavaScript', async ({ baseURL, browser }) => {
	test.skip(!memberUsername || !memberPassword || !mutationsEnabled, 'Enable mutations with a disposable E2E member.');
	const context = await browser.newContext({
		baseURL,
		javaScriptEnabled: false,
		storageState: memberState!,
	});
	const page = await context.newPage();
	const body = `E2E private text post ${Date.now()}`;

	await page.goto('/manage');
	await page.locator('textarea[name="body"]').fill(body);
	await page.locator('select[name="visibility"]').selectOption('private');
	await Promise.all([
		page.waitForURL('**/manage'),
		page.getByRole('button', { name: 'Publish post' }).click(),
	]);
	await expect(page.getByText(/Post #\d+ was created/)).toBeVisible();

	await page.goto('/private');
	await expect(page.getByText(body, { exact: true })).toBeVisible();
	await deletePost(page, body);
	await context.close();
});

test('public post interactions and lifecycle changes remain consistent', async ({
	baseURL,
	browser,
	request,
}) => {
	test.skip(!memberUsername || !memberPassword || !mutationsEnabled, 'Enable mutations with a disposable E2E member.');
	const context = await browser.newContext({ baseURL, storageState: memberState! });
	const page = await context.newPage();
	const body = `E2E public lifecycle post ${Date.now()}`;
	const comment = `E2E interaction comment ${Date.now()}`;

	await page.goto('/manage');
	await page.locator('textarea[name="body"]').fill(body);
	await page.locator('select[name="visibility"]').selectOption('public');
	await Promise.all([
		page.waitForURL('**/manage'),
		page.getByRole('button', { name: 'Publish post' }).click(),
	]);
	const creationMessage = page.getByText(/Post #\d+ was created/);
	await expect(creationMessage).toBeVisible();
	const postId = Number((await creationMessage.textContent())?.match(/Post #(\d+)/u)?.[1]);
	expect(Number.isSafeInteger(postId)).toBe(true);

	await page.goto(`/posts/${postId}`);
	await page.getByRole('button', { name: 'Favorite this post' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Added to favorites.' })).toBeVisible();
	await expect(page.getByText('1 favorite', { exact: true })).toBeVisible();

	await page.getByLabel('Add a comment').fill(comment);
	await page.getByRole('button', { name: 'Post comment' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Your comment was added.' })).toBeVisible();
	await expect(page.getByText(comment, { exact: true })).toBeVisible();

	await page.goto('/manage');
	let item = page.locator('li').filter({ hasText: body }).first();
	await Promise.all([
		page.waitForURL('**/manage'),
		item.getByRole('button', { name: 'Hide post' }).click(),
	]);
	await expect(page.getByText(`Post #${postId} is now hidden.`)).toBeVisible();

	const hiddenResponse = await request.get(`/posts/${postId}`);
	expect(hiddenResponse.status()).toBe(404);
	await page.goto(`/posts/${postId}`);
	await expect(page.getByText('Hidden', { exact: true })).toBeVisible();

	await page.goto('/manage');
	item = page.locator('li').filter({ hasText: body }).first();
	await Promise.all([
		page.waitForURL('**/manage'),
		item.getByRole('button', { name: 'Restore post' }).click(),
	]);
	await expect(page.getByText(`Post #${postId} is now active.`)).toBeVisible();

	const restoredResponse = await request.get(`/posts/${postId}`);
	expect(restoredResponse.ok()).toBe(true);
	expect(await restoredResponse.text()).toContain(body);

	await deletePost(page, body);
	expect((await request.get(`/posts/${postId}`)).status()).toBe(404);
	await context.close();
});

test('a browser can upload directly to R2 and attach the verified asset', async ({ baseURL, browser }) => {
	test.skip(
		!memberUsername || !memberPassword || !mutationsEnabled || !uploadsEnabled,
		'Enable uploads only against disposable Neon and R2 resources.',
	);
	const context = await browser.newContext({ baseURL, storageState: memberState! });
	const page = await context.newPage();
	const body = `E2E private image post ${Date.now()}`;
	const onePixelPng = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
		'base64',
	);

	await page.goto('/manage');
	await page.locator('#media-files').setInputFiles({
		buffer: onePixelPng,
		mimeType: 'image/png',
		name: 'acceptance.png',
	});
	await expect(page.getByText('Files validated. Add alt text, then upload them.')).toBeVisible();
	await page.getByRole('button', { name: 'Upload selected files' }).click();
	await expect(page.getByText('All attachments are ready. You can publish the post.')).toBeVisible({
		timeout: 30_000,
	});
	await page.locator('textarea[name="body"]').fill(body);
	await page.locator('select[name="visibility"]').selectOption('private');
	await Promise.all([
		page.waitForURL('**/manage'),
		page.getByRole('button', { name: 'Publish post' }).click(),
	]);
	await expect(page.getByText(/Post #\d+ was created/)).toBeVisible();

	await page.goto('/private');
	const post = page.locator('article').filter({ hasText: body }).first();
	await expect(post.locator('img')).toBeVisible();
	await deletePost(page, body);
	await context.close();
});

test('the sole owner can reach every owner console', async ({ baseURL, browser }) => {
	test.skip(!ownerUsername || !ownerPassword, 'Set dedicated E2E owner credentials to run this test.');
	const context = await browser.newContext({ baseURL, storageState: ownerState! });
	const page = await context.newPage();

	for (const path of ['/owner/comments', '/owner/posts', '/owner/tags', '/owner/users']) {
		const response = await page.goto(path);
		expect(response?.ok()).toBe(true);
		expect(response?.headers()['cache-control']).toContain('no-store');
	}

	await context.close();
});
