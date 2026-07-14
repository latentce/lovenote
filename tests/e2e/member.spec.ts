import {
	expect,
	type Browser,
	type BrowserContext,
	type Page,
	test,
} from '@playwright/test';
import { AwsClient } from 'aws4fetch';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { createDatabase } from '../../src/db/client';
import { mediaAssets, tags } from '../../src/db/schema';

const memberUsername = process.env.E2E_MEMBER_USERNAME;
const memberPassword = process.env.E2E_MEMBER_PASSWORD;
const ownerUsername = process.env.E2E_OWNER_USERNAME;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;
const mutationsEnabled = process.env.E2E_MUTATIONS === '1';
const uploadsEnabled = process.env.E2E_UPLOADS === '1';
type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

let memberState: StorageState | undefined;
let ownerState: StorageState | undefined;

function r2Configuration() {
	const accessKeyId = process.env.R2_ACCESS_KEY_ID;
	const accountId = process.env.R2_ACCOUNT_ID;
	const bucketName = process.env.R2_BUCKET_NAME;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
	if (!accessKeyId || !accountId || !bucketName || !secretAccessKey) {
		throw new Error('R2 acceptance credentials are not configured.');
	}

	return { accessKeyId, accountId, bucketName, secretAccessKey };
}

async function r2ObjectRequest(objectKey: string, method: 'DELETE' | 'HEAD') {
	const { accessKeyId, accountId, bucketName, secretAccessKey } = r2Configuration();
	const client = new AwsClient({ accessKeyId, region: 'auto', secretAccessKey, service: 's3' });
	const url = new URL(
		`https://${accountId}.r2.cloudflarestorage.com/${encodeURIComponent(bucketName)}/${objectKey}`,
	);
	return fetch(await client.sign(new Request(url, { method })));
}

async function r2ObjectStatus(assetId: string) {
	return (await r2ObjectRequest(`uploads/${assetId}`, 'HEAD')).status;
}

async function cleanupUnattachedAssets(assetIds: string[]) {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl || assetIds.length === 0) return;

	const database = createDatabase(databaseUrl);
	const uploads = await database
		.select({ id: mediaAssets.id, objectKey: mediaAssets.objectKey })
		.from(mediaAssets)
		.where(and(inArray(mediaAssets.id, assetIds), isNull(mediaAssets.postId)));

	for (const upload of uploads) {
		const response = await r2ObjectRequest(upload.objectKey, 'DELETE');
		if (!response.ok) throw new Error(`R2 cleanup failed with status ${response.status}.`);
	}

	if (uploads.length > 0) {
		await database.delete(mediaAssets).where(
			and(inArray(mediaAssets.id, uploads.map((upload) => upload.id)), isNull(mediaAssets.postId)),
		);
	}
}

async function expireUnattachedAsset(assetId: string) {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error('The acceptance database is not configured.');
	const database = createDatabase(databaseUrl);
	await database
		.update(mediaAssets)
		.set({ expiresAt: new Date('2000-01-01T00:00:00.000Z') })
		.where(and(eq(mediaAssets.id, assetId), isNull(mediaAssets.postId)));
}

async function unattachedAssetExists(assetId: string) {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error('The acceptance database is not configured.');
	const database = createDatabase(databaseUrl);
	const rows = await database
		.select({ id: mediaAssets.id })
		.from(mediaAssets)
		.where(and(eq(mediaAssets.id, assetId), isNull(mediaAssets.postId)))
		.limit(1);
	return rows.length === 1;
}

async function generatedWebm(page: Page) {
	const bytes = await page.evaluate(async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 16;
		canvas.height = 16;
		const drawingContext = canvas.getContext('2d');
		if (!drawingContext) throw new Error('Canvas recording is unavailable.');
		const stream = canvas.captureStream(10);
		const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
		const chunks: Blob[] = [];
		recorder.addEventListener('dataavailable', (event) => chunks.push(event.data));
		const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve()));
		recorder.start();

		for (let frame = 0; frame < 10; frame += 1) {
			drawingContext.fillStyle = frame % 2 === 0 ? '#be123c' : '#1d4ed8';
			drawingContext.fillRect(0, 0, canvas.width, canvas.height);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		recorder.stop();
		await stopped;
		stream.getTracks().forEach((track) => track.stop());
		return Array.from(new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()));
	});

	return Buffer.from(bytes);
}

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

async function setMemberCreatePosts(page: Page, username: string, enabled: boolean) {
	await page.goto('/owner/users');
	const item = page.locator('li').filter({ has: page.getByText(`@${username}`, { exact: true }) }).first();
	await expect(item).toBeVisible();
	await item.getByText('Edit capabilities', { exact: true }).click();
	const checkbox = item.getByLabel('Create posts', { exact: true });
	const wasEnabled = await checkbox.isChecked();

	if (wasEnabled !== enabled) {
		if (enabled) {
			await checkbox.check();
		} else {
			await checkbox.uncheck();
		}
		await item.getByRole('button', { name: 'Save capabilities' }).click();
		await expect(page.getByRole('status').filter({ hasText: /Capabilities for @.+ were updated\./u })).toBeVisible();
	}

	return wasEnabled;
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

test('private R2 media supports secure conditional and range delivery', async ({
	baseURL,
	browser,
	request,
}) => {
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

	let assetId: string | undefined;
	let postCreated = false;

	try {
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
		assetId = await page.locator('input[name="attachmentIds"]').inputValue();
		await page.locator('textarea[name="body"]').fill(body);
		await page.locator('select[name="visibility"]').selectOption('private');
		await page.getByRole('button', { name: 'Publish post' }).click();
		await expect(page.getByText(/Post #\d+ was created/)).toBeVisible();
		postCreated = true;

		await page.goto('/private');
		const post = page.locator('article').filter({ hasText: body }).first();
		const image = post.locator('img');
		await expect(image).toBeVisible();
		const mediaUrl = await image.getAttribute('src');
		expect(mediaUrl).toBeTruthy();
		const route = new URL(mediaUrl!, baseURL).pathname;
		const routeParts = route.split('/');
		expect(routeParts[2]).toBe(assetId);
		expect(assetId).toMatch(/^[0-9a-f-]{36}$/u);
		expect(await r2ObjectStatus(assetId!)).toBe(200);

		const anonymousResponse = await request.get(route);
		expect(anonymousResponse.status()).toBe(404);
		expect(anonymousResponse.headers()['cache-control']).toBe('private, no-store');

		const headResponse = await context.request.head(route);
		expect(headResponse.status()).toBe(200);
		expect(headResponse.headers()['accept-ranges']).toBe('bytes');
		expect(headResponse.headers()['cache-control']).toBe('private, no-store');
		expect(headResponse.headers()['content-length']).toBe(String(onePixelPng.length));
		expect(headResponse.headers()['content-type']).toBe('image/png');
		expect(headResponse.headers()['x-content-type-options']).toBe('nosniff');
		expect(await headResponse.body()).toHaveLength(0);
		const etag = headResponse.headers().etag;
		expect(etag).toMatch(/^".+"$/u);

		const rangeResponse = await context.request.get(route, { headers: { Range: 'bytes=0-7' } });
		expect(rangeResponse.status()).toBe(206);
		expect(rangeResponse.headers()['content-length']).toBe('8');
		expect(rangeResponse.headers()['content-range']).toBe(`bytes 0-7/${onePixelPng.length}`);
		expect(await rangeResponse.body()).toEqual(onePixelPng.subarray(0, 8));

		const unchangedResponse = await context.request.get(route, {
			headers: { 'If-None-Match': etag! },
		});
		expect(unchangedResponse.status()).toBe(304);
		expect(await unchangedResponse.body()).toHaveLength(0);

		const changedResponse = await context.request.get(route, {
			headers: { 'If-Match': '"different"' },
		});
		expect(changedResponse.status()).toBe(412);
		expect(changedResponse.headers()['cache-control']).toBe('private, no-store');

		const unsatisfiableResponse = await context.request.get(route, {
			headers: { Range: `bytes=${onePixelPng.length}-` },
		});
		expect(unsatisfiableResponse.status()).toBe(416);
		expect(unsatisfiableResponse.headers()['content-range']).toBe(`bytes */${onePixelPng.length}`);

		const wrongRevision = [...routeParts];
		wrongRevision[3] = String(Number(wrongRevision[3]) + 1);
		expect((await context.request.get(wrongRevision.join('/'))).status()).toBe(404);
		const wrongFilename = [...routeParts];
		wrongFilename[4] = 'different.png';
		expect((await context.request.get(wrongFilename.join('/'))).status()).toBe(404);

		await deletePost(page, body);
		postCreated = false;
		expect((await context.request.get(route)).status()).toBe(404);
		expect(await r2ObjectStatus(assetId!)).toBe(404);
	} finally {
		if (postCreated) await deletePost(page, body);
		if (!postCreated && assetId) await cleanupUnattachedAssets([assetId]);
		await context.close();
	}
});

test('mixed image and video attachments preserve order and public delivery', async ({
	baseURL,
	browser,
	request,
}) => {
	test.skip(
		!memberUsername || !memberPassword || !mutationsEnabled || !uploadsEnabled,
		'Enable uploads only against disposable Neon and R2 resources.',
	);
	const context = await browser.newContext({ baseURL, storageState: memberState! });
	const page = await context.newPage();
	const body = `E2E mixed-media post ${Date.now()}`;
	const image = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
		'base64',
	);
	let assetIds: string[] = [];
	let postCreated = false;

	try {
		await page.goto('/manage');
		const video = await generatedWebm(page);
		await page.locator('#media-files').setInputFiles([
			{ buffer: image, mimeType: 'image/png', name: 'first.png' },
			{ buffer: video, mimeType: 'video/webm', name: 'second.webm' },
		]);
		await expect(page.getByText('Files validated. Add alt text, then upload them.')).toBeVisible();
		await page.getByLabel('Alt text (optional)').nth(0).fill('First acceptance image');
		await page.getByLabel('Alt text (optional)').nth(1).fill('Second acceptance video');
		await page.getByRole('button', { name: 'Upload selected files' }).click();
		await expect(page.getByText('All attachments are ready. You can publish the post.')).toBeVisible({
			timeout: 30_000,
		});
		assetIds = await page.locator('input[name="attachmentIds"]').evaluateAll((inputs) =>
			inputs.map((input) => (input as HTMLInputElement).value),
		);
		expect(assetIds).toHaveLength(2);
		await page.locator('textarea[name="body"]').fill(body);
		await page.locator('select[name="visibility"]').selectOption('public');
		await page.getByRole('button', { name: 'Publish post' }).click();
		const creationMessage = page.getByText(/Post #\d+ was created/);
		await expect(creationMessage).toBeVisible();
		postCreated = true;
		const postId = Number((await creationMessage.textContent())?.match(/Post #(\d+)/u)?.[1]);
		expect(Number.isSafeInteger(postId)).toBe(true);

		await page.goto(`/posts/${postId}`);
		const media = page.locator('article').locator('img, video');
		await expect(media).toHaveCount(2);
		expect(await media.evaluateAll((elements) => elements.map((element) => element.tagName))).toEqual([
			'IMG',
			'VIDEO',
		]);
		await expect(media.nth(0)).toHaveAttribute('alt', 'First acceptance image');
		await expect(media.nth(1)).toHaveAttribute('aria-label', 'Second acceptance video');
		await expect(media.nth(1)).toHaveAttribute('preload', 'metadata');

		const routes = await media.evaluateAll((elements) =>
			elements.map((element) => new URL((element as HTMLMediaElement).currentSrc || (element as HTMLMediaElement).src).pathname),
		);
		expect(routes).toHaveLength(2);
		expect(routes[0]).toContain(assetIds[0]);
		expect(routes[1]).toContain(assetIds[1]);

		const imageResponse = await request.get(routes[0]!);
		expect(imageResponse.status()).toBe(200);
		expect(imageResponse.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
		expect(imageResponse.headers()['content-type']).toBe('image/png');
		expect(await imageResponse.body()).toEqual(image);

		const videoResponse = await request.get(routes[1]!, { headers: { Range: 'bytes=0-31' } });
		expect(videoResponse.status()).toBe(206);
		expect(videoResponse.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
		expect(videoResponse.headers()['content-range']).toBe(`bytes 0-31/${video.length}`);
		expect(videoResponse.headers()['content-type']).toBe('video/webm');
		expect(await videoResponse.body()).toEqual(video.subarray(0, 32));

		await deletePost(page, body);
		postCreated = false;
		for (const [index, assetId] of assetIds.entries()) {
			expect((await request.get(routes[index]!)).status()).toBe(404);
			expect(await r2ObjectStatus(assetId)).toBe(404);
		}
	} finally {
		if (postCreated) await deletePost(page, body);
		if (!postCreated) await cleanupUnattachedAssets(assetIds);
		await context.close();
	}
});

test('making a public media post private rotates and purges every public route', async ({
	baseURL,
	browser,
	request,
}) => {
	test.skip(
		!memberUsername || !memberPassword || !mutationsEnabled || !uploadsEnabled,
		'Enable uploads only against disposable Neon and R2 resources.',
	);
	const context = await browser.newContext({ baseURL, storageState: memberState! });
	const page = await context.newPage();
	const body = `E2E visibility transition ${Date.now()}`;
	const image = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
		'base64',
	);
	let assetId: string | undefined;
	let postCreated = false;

	try {
		await page.goto('/manage');
		await page.locator('#media-files').setInputFiles({
			buffer: image,
			mimeType: 'image/png',
			name: 'visibility.png',
		});
		await expect(page.getByText('Files validated. Add alt text, then upload them.')).toBeVisible();
		await page.getByRole('button', { name: 'Upload selected files' }).click();
		await expect(page.getByText('All attachments are ready. You can publish the post.')).toBeVisible({
			timeout: 30_000,
		});
		assetId = await page.locator('input[name="attachmentIds"]').inputValue();
		await page.locator('textarea[name="body"]').fill(body);
		await page.locator('select[name="visibility"]').selectOption('public');
		await page.getByRole('button', { name: 'Publish post' }).click();
		const creationMessage = page.getByText(/Post #\d+ was created/);
		await expect(creationMessage).toBeVisible();
		postCreated = true;
		const postId = Number((await creationMessage.textContent())?.match(/Post #(\d+)/u)?.[1]);
		expect(Number.isSafeInteger(postId)).toBe(true);

		const publicDetail = await request.get(`/posts/${postId}`);
		expect(publicDetail.status()).toBe(200);
		const detailHtml = await publicDetail.text();
		expect(detailHtml).toContain(body);
		const oldRoute = new RegExp(`(/media/${assetId}/1/visibility\\.png)`, 'u').exec(detailHtml)?.[1];
		expect(oldRoute).toBeTruthy();
		expect((await request.get(oldRoute!)).status()).toBe(200);
		expect(await (await request.get('/')).text()).toContain(body);
		expect(await (await request.get('/archive')).text()).toContain(`/posts/${postId}`);

		await page.goto(`/manage/posts/${postId}`);
		await page.locator('select[name="visibility"]').selectOption('private');
		const [editResponse] = await Promise.all([
			page.waitForResponse((response) => response.request().method() === 'POST'),
			page.getByRole('button', { name: 'Save changes' }).click(),
		]);
		expect(editResponse.status()).toBe(200);
		await expect(page.getByRole('status').filter({ hasText: 'Post saved.' })).toBeVisible();

		expect((await request.get(`/posts/${postId}`)).status()).toBe(404);
		expect((await request.get(oldRoute!)).status()).toBe(404);
		expect(await (await request.get('/')).text()).not.toContain(body);
		expect(await (await request.get('/archive')).text()).not.toContain(`/posts/${postId}`);

		await page.goto(`/posts/${postId}`);
		const newRoute = new URL((await page.locator('article img').getAttribute('src'))!, baseURL).pathname;
		expect(newRoute).toContain(`/media/${assetId}/2/`);
		const anonymousMedia = await request.get(newRoute);
		expect(anonymousMedia.status()).toBe(404);
		expect(anonymousMedia.headers()['cache-control']).toBe('private, no-store');
		const memberMedia = await context.request.get(newRoute);
		expect(memberMedia.status()).toBe(200);
		expect(memberMedia.headers()['cache-control']).toBe('private, no-store');
		expect(await memberMedia.body()).toEqual(image);
		expect(await r2ObjectStatus(assetId)).toBe(200);

		await deletePost(page, body);
		postCreated = false;
		expect(await r2ObjectStatus(assetId)).toBe(404);
	} finally {
		if (postCreated) await deletePost(page, body);
		if (!postCreated && assetId) await cleanupUnattachedAssets([assetId]);
		await context.close();
	}
});

test('the owner can clean up an expired unattached R2 upload', async ({ baseURL, browser }) => {
	test.skip(
		!memberUsername || !memberPassword || !ownerUsername || !ownerPassword || !mutationsEnabled || !uploadsEnabled,
		'Enable uploads only against disposable Neon and R2 resources.',
	);
	const memberContext = await browser.newContext({ baseURL, storageState: memberState! });
	const ownerContext = await browser.newContext({ baseURL, storageState: ownerState! });
	const memberPage = await memberContext.newPage();
	const ownerPage = await ownerContext.newPage();
	const image = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
		'base64',
	);
	let assetId: string | undefined;

	try {
		await memberPage.goto('/manage');
		await memberPage.locator('#media-files').setInputFiles({
			buffer: image,
			mimeType: 'image/png',
			name: 'abandoned.png',
		});
		await expect(memberPage.getByText('Files validated. Add alt text, then upload them.')).toBeVisible();
		await memberPage.getByRole('button', { name: 'Upload selected files' }).click();
		await expect(memberPage.getByText('All attachments are ready. You can publish the post.')).toBeVisible({
			timeout: 30_000,
		});
		assetId = await memberPage.locator('input[name="attachmentIds"]').inputValue();
		expect(await r2ObjectStatus(assetId)).toBe(200);
		expect(await unattachedAssetExists(assetId)).toBe(true);
		await expireUnattachedAsset(assetId);

		await ownerPage.goto('/owner/posts');
		await ownerPage.locator('input[name="confirmation"][value="cleanup"]').check();
		await ownerPage.getByRole('button', { name: 'Run cleanup' }).click();
		await expect(ownerPage.getByRole('status').filter({ hasText: /Removed 1 of 1 expired uploads found\./u })).toBeVisible();
		expect(await r2ObjectStatus(assetId)).toBe(404);
		expect(await unattachedAssetExists(assetId)).toBe(false);
		assetId = undefined;
	} finally {
		if (assetId) await cleanupUnattachedAssets([assetId]);
		await memberContext.close();
		await ownerContext.close();
	}
});

test('the owner can hide, restore, and permanently delete a member comment', async ({
	baseURL,
	browser,
}) => {
	test.skip(
		!memberUsername || !memberPassword || !ownerUsername || !ownerPassword || !mutationsEnabled,
		'Enable mutations with dedicated E2E owner and member accounts.',
	);
	const memberContext = await browser.newContext({ baseURL, storageState: memberState! });
	const ownerContext = await browser.newContext({ baseURL, storageState: ownerState! });
	const memberPage = await memberContext.newPage();
	const ownerPage = await ownerContext.newPage();
	const body = `E2E moderated-comment post ${Date.now()}`;
	const comment = `E2E owner moderation comment ${Date.now()}`;
	let postCreated = false;

	try {
		await memberPage.goto('/manage');
		await memberPage.locator('textarea[name="body"]').fill(body);
		await memberPage.locator('select[name="visibility"]').selectOption('public');
		await memberPage.getByRole('button', { name: 'Publish post' }).click();
		const creationMessage = memberPage.getByText(/Post #\d+ was created/);
		await expect(creationMessage).toBeVisible();
		postCreated = true;
		const postId = Number((await creationMessage.textContent())?.match(/Post #(\d+)/u)?.[1]);
		expect(Number.isSafeInteger(postId)).toBe(true);

		await memberPage.goto(`/posts/${postId}`);
		await memberPage.getByLabel('Add a comment').fill(comment);
		await memberPage.getByRole('button', { name: 'Post comment' }).click();
		await expect(memberPage.getByText(comment, { exact: true })).toBeVisible();

		await ownerPage.goto('/owner/comments');
		let item = ownerPage.locator('li').filter({ hasText: comment }).first();
		await expect(item).toBeVisible();
		await item.getByRole('button', { name: 'Hide comment' }).click();
		await expect(ownerPage.getByRole('status').filter({ hasText: /was hidden\./u })).toBeVisible();

		await memberPage.goto(`/posts/${postId}`);
		await expect(memberPage.getByText(comment, { exact: true })).toHaveCount(0);

		await ownerPage.goto('/owner/comments');
		item = ownerPage.locator('li').filter({ hasText: comment }).first();
		await item.getByRole('button', { name: 'Restore comment' }).click();
		await expect(ownerPage.getByRole('status').filter({ hasText: /was restored\./u })).toBeVisible();

		await memberPage.goto(`/posts/${postId}`);
		await expect(memberPage.getByText(comment, { exact: true })).toBeVisible();

		await ownerPage.goto('/owner/comments');
		item = ownerPage.locator('li').filter({ hasText: comment }).first();
		await item.getByText('Permanently delete', { exact: true }).click();
		await item.locator('input[name="confirmation"]').check();
		await item.getByRole('button', { name: 'Delete comment' }).click();
		await expect(ownerPage.getByRole('status').filter({ hasText: /was deleted\./u })).toBeVisible();

		await memberPage.goto(`/posts/${postId}`);
		await expect(memberPage.getByText(comment, { exact: true })).toHaveCount(0);
	} finally {
		if (postCreated) await deletePost(memberPage, body);
		await memberContext.close();
		await ownerContext.close();
	}
});

test('capability revocation takes effect for an existing member session', async ({ baseURL, browser }) => {
	test.skip(
		!memberUsername || !memberPassword || !ownerUsername || !ownerPassword || !mutationsEnabled,
		'Enable mutations with dedicated E2E owner and member accounts.',
	);
	const memberContext = await browser.newContext({ baseURL, storageState: memberState! });
	const ownerContext = await browser.newContext({ baseURL, storageState: ownerState! });
	const memberPage = await memberContext.newPage();
	const ownerPage = await ownerContext.newPage();
	let capabilityWasEnabled = false;

	try {
		capabilityWasEnabled = await setMemberCreatePosts(ownerPage, memberUsername!, false);
		expect(capabilityWasEnabled).toBe(true);

		await memberPage.goto('/manage');
		await expect(memberPage.getByText(/cannot create posts with the current account permissions/u)).toBeVisible();
		await expect(memberPage.getByRole('button', { name: 'Publish post' })).toHaveCount(0);
	} finally {
		if (capabilityWasEnabled) await setMemberCreatePosts(ownerPage, memberUsername!, true);
		await memberContext.close();
		await ownerContext.close();
	}
});

test('tag metadata and merges invalidate every affected public page', async ({ baseURL, browser }) => {
	test.skip(
		!memberUsername || !memberPassword || !ownerUsername || !ownerPassword || !mutationsEnabled,
		'Enable mutations with dedicated E2E owner and member accounts.',
	);
	const suffix = Date.now().toString(36);
	const sourceName = `E2E Source ${suffix}`;
	const sourceSlug = `e2e-source-${suffix}`;
	const targetName = `E2E Target ${suffix}`;
	const targetSlug = `e2e-target-${suffix}`;
	const updatedName = `E2E Canonical ${suffix}`;
	const updatedSlug = `e2e-canonical-${suffix}`;
	const updatedDescription = `Canonical acceptance metadata ${suffix}.`;
	const body = `Tag acceptance post ${suffix}`;
	const memberContext = await browser.newContext({ baseURL, storageState: memberState! });
	const ownerContext = await browser.newContext({ baseURL, storageState: ownerState! });
	const publicContext = await browser.newContext({ baseURL });
	const memberPage = await memberContext.newPage();
	const ownerPage = await ownerContext.newPage();
	const publicPage = await publicContext.newPage();
	let postCreated = false;

	async function createTag(displayName: string, slug: string) {
		await ownerPage.goto('/owner/tags');
		const section = ownerPage.locator('section').filter({
			has: ownerPage.getByRole('heading', { name: 'Create tag' }),
		});
		await section.getByLabel('Display name').fill(displayName);
		await section.getByLabel('URL slug').fill(slug);
		await section.getByRole('button', { name: 'Create tag' }).click();
		await expect(ownerPage.getByRole('status').filter({ hasText: `Tag #${slug} was created.` })).toBeVisible();
	}

	try {
		await createTag(sourceName, sourceSlug);
		await createTag(targetName, targetSlug);

		await memberPage.goto('/manage');
		await memberPage.getByLabel('Post text').fill(body);
		await memberPage.getByLabel('Visibility').selectOption('public');
		await memberPage.getByLabel(`#${sourceName}`, { exact: true }).check();
		await memberPage.getByLabel(`#${targetName}`, { exact: true }).check();
		await memberPage.getByRole('button', { name: 'Publish post' }).click();
		const creationMessage = memberPage.getByText(/Post #\d+ was created/);
		await expect(creationMessage).toBeVisible();
		postCreated = true;
		const postId = Number((await creationMessage.textContent())?.match(/Post #(\d+)/u)?.[1]);
		expect(Number.isSafeInteger(postId)).toBe(true);

		for (const path of ['/tags', `/tags/${sourceSlug}`, `/tags/${targetSlug}`, `/posts/${postId}`]) {
			const response = await publicPage.goto(path);
			expect(response?.ok()).toBe(true);
		}

		await ownerPage.goto('/owner/tags');
		const targetItem = ownerPage.locator('li').filter({ hasText: `#${targetName}` }).first();
		await targetItem.getByText('Edit metadata', { exact: true }).click();
		await targetItem.getByLabel('Display name').fill(updatedName);
		await targetItem.getByLabel('URL slug').fill(updatedSlug);
		await targetItem.getByLabel('Description').fill(updatedDescription);
		await targetItem.getByRole('button', { name: 'Save metadata' }).click();
		await expect(ownerPage.getByRole('status').filter({ hasText: `Tag #${updatedSlug} was updated.` })).toBeVisible();

		let response = await publicPage.goto(`/tags/${targetSlug}`);
		expect(response?.status()).toBe(404);
		response = await publicPage.goto(`/tags/${updatedSlug}`);
		expect(response?.ok()).toBe(true);
		await expect(publicPage.getByRole('heading', { name: `#${updatedName}` })).toBeVisible();
		await expect(publicPage.getByText(updatedDescription, { exact: true })).toBeVisible();
		await expect(publicPage.getByText(body, { exact: true })).toBeVisible();

		await publicPage.goto('/tags');
		await expect(publicPage.getByRole('heading', { name: `#${updatedName}` })).toBeVisible();
		await expect(publicPage.getByRole('heading', { name: `#${targetName}` })).toHaveCount(0);

		await ownerPage.goto('/owner/tags');
		await ownerPage.getByLabel('Source tag').selectOption({ label: `#${sourceName}` });
		await ownerPage.getByLabel('Target tag').selectOption({ label: `#${updatedName}` });
		await ownerPage.locator('input[name="confirmation"][value="merge"]').check();
		await ownerPage.getByRole('button', { name: 'Merge tags' }).click();
		await expect(
			ownerPage.getByRole('status').filter({
				hasText: `Tag #${sourceSlug} was merged into #${updatedSlug}.`,
			}),
		).toBeVisible();

		response = await publicPage.goto(`/tags/${sourceSlug}`);
		expect(response?.status()).toBe(404);
		await publicPage.goto(`/tags/${updatedSlug}`);
		await expect(publicPage.getByText('1 public post', { exact: true })).toBeVisible();
		await expect(publicPage.getByText(body, { exact: true })).toBeVisible();

		await publicPage.goto(`/posts/${postId}`);
		await expect(publicPage.getByRole('link', { name: `#${updatedName}` })).toBeVisible();
		await expect(publicPage.getByRole('link', { name: `#${sourceName}` })).toHaveCount(0);
	} finally {
		if (postCreated) await deletePost(memberPage, body);
		const databaseUrl = process.env.DATABASE_URL;
		if (databaseUrl) {
			await createDatabase(databaseUrl)
				.delete(tags)
				.where(inArray(tags.slug, [sourceSlug, targetSlug, updatedSlug]));
		}
		await memberContext.close();
		await ownerContext.close();
		await publicContext.close();
	}
});

test('owner session revocation and bans invalidate active member sessions', async ({ baseURL, browser }) => {
	test.skip(
		!memberUsername || !memberPassword || !ownerUsername || !ownerPassword || !mutationsEnabled,
		'Enable mutations with dedicated E2E owner and member accounts.',
	);
	const revokedMemberContext = await browser.newContext({ baseURL, storageState: memberState! });
	const ownerContext = await browser.newContext({ baseURL, storageState: ownerState! });
	const revokedMemberPage = await revokedMemberContext.newPage();
	const ownerPage = await ownerContext.newPage();
	let freshMemberContext: BrowserContext | undefined;
	let accountIsBanned = false;

	const memberItem = () =>
		ownerPage
			.locator('li')
			.filter({ has: ownerPage.getByText(`@${memberUsername}`, { exact: true }) })
			.first();

	try {
		await ownerPage.goto('/owner/users');
		let item = memberItem();
		await expect(item).toBeVisible();
		await item.getByText('Revoke all sessions', { exact: true }).click();
		await item.locator('input[name="confirmation"][value="revoke"]').check();
		await item.getByRole('button', { name: 'Revoke sessions' }).click();
		await expect(
			ownerPage.getByRole('status').filter({
				hasText: `All active sessions for @${memberUsername} were revoked.`,
			}),
		).toBeVisible();

		await revokedMemberPage.goto('/private');
		await expect(revokedMemberPage).toHaveURL(/\/login$/u);

		const freshState = await authenticatedState(browser, baseURL!, memberUsername!, memberPassword!);
		freshMemberContext = await browser.newContext({ baseURL, storageState: freshState });
		const freshMemberPage = await freshMemberContext.newPage();
		await freshMemberPage.goto('/private');
		await expect(freshMemberPage).toHaveURL(/\/private$/u);

		await ownerPage.goto('/owner/users');
		item = memberItem();
		await item.locator('summary').filter({ hasText: 'Ban member' }).click();
		await item.locator('input[name="confirmation"][value="ban"]').check();
		await item.getByRole('button', { name: 'Ban member' }).click();
		accountIsBanned = true;
		await expect(ownerPage.getByRole('status').filter({ hasText: `@${memberUsername} is now banned.` })).toBeVisible();

		await freshMemberPage.goto('/private');
		await expect(freshMemberPage).toHaveURL(/\/login$/u);

		await ownerPage.goto('/owner/users');
		item = memberItem();
		await item.getByRole('button', { name: 'Restore account access' }).click();
		accountIsBanned = false;
		await expect(ownerPage.getByRole('status').filter({ hasText: `@${memberUsername} is now active.` })).toBeVisible();
	} finally {
		if (accountIsBanned) {
			await ownerPage.goto('/owner/users');
			const restoreButton = memberItem().getByRole('button', { name: 'Restore account access' });
			if (await restoreButton.isVisible()) await restoreButton.click();
		}
		await freshMemberContext?.close();
		await revokedMemberContext.close();
		await ownerContext.close();
	}
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
