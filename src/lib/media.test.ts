import { describe, expect, it } from 'vitest';

import {
	IMAGE_UPLOAD_LIMIT,
	matchesMediaSignature,
	requestUploadInputSchema,
	signUploadUrl,
	UPLOAD_URL_LIFETIME_SECONDS,
	uploadedObjectMetadataMatches,
	VIDEO_UPLOAD_LIMIT,
} from './media';

const image = {
	byteSize: IMAGE_UPLOAD_LIMIT,
	height: 1080,
	mimeType: 'image/jpeg',
	originalFilename: 'photo.JPG',
	width: 1920,
};

const video = {
	byteSize: VIDEO_UPLOAD_LIMIT,
	durationMs: 60_000,
	height: 1080,
	mimeType: 'video/mp4',
	originalFilename: 'clip.mp4',
	width: 1920,
};

describe('media upload input', () => {
	it.each([
		['image/jpeg', 'photo.jpeg'],
		['image/png', 'photo.png'],
		['image/webp', 'photo.webp'],
		['image/gif', 'photo.gif'],
		['image/avif', 'photo.avif'],
	])('accepts supported %s images', (mimeType, originalFilename) => {
		expect(requestUploadInputSchema.safeParse({ ...image, mimeType, originalFilename }).success).toBe(
			true,
		);
	});

	it.each([
		['video/mp4', 'clip.mp4'],
		['video/webm', 'clip.webm'],
	])('accepts supported %s videos', (mimeType, originalFilename) => {
		expect(requestUploadInputSchema.safeParse({ ...video, mimeType, originalFilename }).success).toBe(
			true,
		);
	});

	it.each([
		['image/svg+xml', 'image.svg'],
		['image/heic', 'image.heic'],
		['video/quicktime', 'clip.mov'],
		['application/x-msdownload', 'program.exe'],
	])('rejects unsupported %s files', (mimeType, originalFilename) => {
		expect(requestUploadInputSchema.safeParse({ ...image, mimeType, originalFilename }).success).toBe(
			false,
		);
	});

	it('enforces different image and video byte limits', () => {
		expect(requestUploadInputSchema.safeParse({ ...image, byteSize: IMAGE_UPLOAD_LIMIT + 1 }).success).toBe(
			false,
		);
		expect(requestUploadInputSchema.safeParse({ ...video, byteSize: VIDEO_UPLOAD_LIMIT + 1 }).success).toBe(
			false,
		);
	});

	it('rejects mismatched extensions and media metadata', () => {
		expect(requestUploadInputSchema.safeParse({ ...image, originalFilename: 'photo.png' }).success).toBe(
			false,
		);
		expect(requestUploadInputSchema.safeParse({ ...image, durationMs: 100 }).success).toBe(false);
		expect(requestUploadInputSchema.safeParse({ ...video, durationMs: null }).success).toBe(false);
	});

	it('rejects unsafe filenames and invalid dimensions', () => {
		expect(requestUploadInputSchema.safeParse({ ...image, originalFilename: '../photo.jpg' }).success).toBe(
			false,
		);
		expect(requestUploadInputSchema.safeParse({ ...image, width: 0 }).success).toBe(false);
	});
});

function bytes(...values: number[]) {
	return new Uint8Array(values);
}

function ascii(value: string) {
	return new TextEncoder().encode(value);
}

describe('uploaded media verification', () => {
	it.each([
		['image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0)],
		['image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
		['image/gif', ascii('GIF89a')],
		['image/webp', ascii('RIFF0000WEBP')],
		['image/avif', bytes(0, 0, 0, 20, ...ascii('ftypavif'), 0, 0, 0, 0, ...ascii('avif'))],
		['video/mp4', bytes(0, 0, 0, 20, ...ascii('ftypisom'), 0, 0, 0, 0, ...ascii('mp42'))],
		['video/webm', bytes(0x1a, 0x45, 0xdf, 0xa3)],
	] as const)('accepts the expected %s signature', (mimeType, signature) => {
		expect(matchesMediaSignature(mimeType, signature)).toBe(true);
	});

	it('rejects content disguised with an allowed MIME type', () => {
		expect(matchesMediaSignature('image/jpeg', ascii('<svg onload=alert(1)>'))).toBe(false);
		expect(matchesMediaSignature('video/mp4', bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe(false);
		expect(
			matchesMediaSignature(
				'video/mp4',
				bytes(0, 0, 0, 20, ...ascii('ftypqt  '), 0, 0, 0, 0, ...ascii('qt  ')),
			),
		).toBe(false);
	});

	it('requires the authoritative R2 size and content type to match', () => {
		expect(
			uploadedObjectMetadataMatches(
				{ byteSize: 1_024, mimeType: 'image/png' },
				{ contentType: 'image/png', size: 1_024 },
			),
		).toBe(true);
		expect(
			uploadedObjectMetadataMatches(
				{ byteSize: 1_024, mimeType: 'image/png' },
				{ contentType: 'image/jpeg', size: 1_024 },
			),
		).toBe(false);
		expect(
			uploadedObjectMetadataMatches(
				{ byteSize: 1_024, mimeType: 'image/png' },
				{ contentType: 'image/png', size: 2_048 },
			),
		).toBe(false);
	});
});

describe('R2 upload signing', () => {
	it('binds a PUT URL to its key, content type, and ten-minute lifetime', async () => {
		const now = new Date('2026-07-13T18:00:00.000Z');
		const result = await signUploadUrl({
			accessKeyId: 'test-access-key',
			accountId: '0123456789abcdef0123456789abcdef',
			bucketName: 'test-media',
			contentType: 'image/png',
			now,
			objectKey: 'uploads/3df91f2d-582c-4d2a-b24d-c42d2ed58f7d',
			secretAccessKey: 'test-secret-key',
		});
		const url = result.uploadUrl;

		expect(url.hostname).toBe('0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com');
		expect(url.pathname).toBe(
			'/test-media/uploads/3df91f2d-582c-4d2a-b24d-c42d2ed58f7d',
		);
		expect(url.searchParams.get('X-Amz-Expires')).toBe(String(UPLOAD_URL_LIFETIME_SECONDS));
		expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');
		expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('if-none-match');
		expect(result.headers).toEqual({ 'Content-Type': 'image/png', 'If-None-Match': '*' });
		expect(result.expiresAt).toEqual(new Date('2026-07-13T18:10:00.000Z'));
		expect(url.toString()).not.toContain('test-secret-key');
	});
});
