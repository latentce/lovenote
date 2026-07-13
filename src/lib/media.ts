import { AwsClient } from 'aws4fetch';
import { z } from 'zod';

export const IMAGE_UPLOAD_LIMIT = 50 * 1024 * 1024;
export const VIDEO_UPLOAD_LIMIT = 250 * 1024 * 1024;
export const UPLOAD_URL_LIFETIME_SECONDS = 10 * 60;
export const UNATTACHED_UPLOAD_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const MEDIA_SIGNATURE_BYTE_COUNT = 512;

const mediaTypes = {
	'image/avif': { extensions: ['avif'], kind: 'image', limit: IMAGE_UPLOAD_LIMIT },
	'image/gif': { extensions: ['gif'], kind: 'image', limit: IMAGE_UPLOAD_LIMIT },
	'image/jpeg': { extensions: ['jpg', 'jpeg'], kind: 'image', limit: IMAGE_UPLOAD_LIMIT },
	'image/png': { extensions: ['png'], kind: 'image', limit: IMAGE_UPLOAD_LIMIT },
	'image/webp': { extensions: ['webp'], kind: 'image', limit: IMAGE_UPLOAD_LIMIT },
	'video/mp4': { extensions: ['mp4'], kind: 'video', limit: VIDEO_UPLOAD_LIMIT },
	'video/webm': { extensions: ['webm'], kind: 'video', limit: VIDEO_UPLOAD_LIMIT },
} as const;

export type SupportedMediaType = keyof typeof mediaTypes;
export type MediaKind = (typeof mediaTypes)[SupportedMediaType]['kind'];
export const SUPPORTED_MEDIA_TYPES = Object.freeze(
	Object.keys(mediaTypes) as SupportedMediaType[],
);

export function isSupportedMediaType(mimeType: string): mimeType is SupportedMediaType {
	return mimeType in mediaTypes;
}

export function mediaKindForMimeType(mimeType: SupportedMediaType): MediaKind;
export function mediaKindForMimeType(mimeType: string): MediaKind | null;
export function mediaKindForMimeType(mimeType: string): MediaKind | null {
	return isSupportedMediaType(mimeType) ? mediaTypes[mimeType].kind : null;
}

const filenameSchema = z
	.string()
	.min(1, 'The file must have a name.')
	.max(255, 'The filename must be 255 characters or less.')
	.refine((filename) => !/[\u0000-\u001f\u007f/\\]/u.test(filename), 'The filename is invalid.');

export const requestUploadInputSchema = z
	.object({
		altText: z.string().max(1000, 'Alt text must be 1,000 characters or less.').default(''),
		byteSize: z.number().int().positive(),
		durationMs: z.number().int().positive().max(2_147_483_647).nullable().optional(),
		height: z.number().int().positive().max(100_000),
		mimeType: z.string(),
		originalFilename: filenameSchema,
		width: z.number().int().positive().max(100_000),
	})
	.superRefine((input, context) => {
		if (!isSupportedMediaType(input.mimeType)) {
			context.addIssue({
				code: 'custom',
				message: 'Choose a supported JPEG, PNG, WebP, GIF, AVIF, MP4, or WebM file.',
				path: ['mimeType'],
			});
			return;
		}
		const configuration = mediaTypes[input.mimeType];

		if (input.byteSize > configuration.limit) {
			context.addIssue({
				code: 'too_big',
				maximum: configuration.limit,
				message: `${configuration.kind === 'image' ? 'Images' : 'Videos'} must be ${configuration.limit / 1024 / 1024} MB or less.`,
				origin: 'number',
				path: ['byteSize'],
			});
		}

		const extension = input.originalFilename.split('.').at(-1)?.toLowerCase();
		if (!(extension && (configuration.extensions as readonly string[]).includes(extension))) {
			context.addIssue({
				code: 'custom',
				message: 'The filename extension does not match the selected file type.',
				path: ['originalFilename'],
			});
		}

		if (configuration.kind === 'image' && input.durationMs != null) {
			context.addIssue({
				code: 'custom',
				message: 'Images cannot include video duration metadata.',
				path: ['durationMs'],
			});
		}

		if (configuration.kind === 'video' && input.durationMs == null) {
			context.addIssue({
				code: 'custom',
				message: 'Video duration metadata is required.',
				path: ['durationMs'],
			});
		}
	});

export type RequestUploadInput = z.infer<typeof requestUploadInputSchema>;

export const mediaAssetIdSchema = z.uuid();
export const completeUploadInputSchema = z.object({ assetId: mediaAssetIdSchema });
export const cleanupExpiredUploadsInputSchema = z.object({
	confirmation: z.literal('cleanup'),
});

function bytesMatch(bytes: Uint8Array, offset: number, expected: readonly number[]) {
	return expected.every((value, index) => bytes[offset + index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number) {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function isoBaseMediaBrands(bytes: Uint8Array) {
	if (bytes.length < 12 || asciiAt(bytes, 4, 4) !== 'ftyp') {
		return [];
	}

	const declaredSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
	const boxEnd = Math.min(declaredSize, bytes.length);
	const brands: string[] = [];

	for (let offset = 8; offset + 4 <= boxEnd; offset += 4) {
		brands.push(asciiAt(bytes, offset, 4));
	}

	return brands;
}

const mp4Brands = new Set(['M4V ', 'av01', 'avc1', 'dash', 'iso2', 'iso5', 'iso6', 'isom', 'mp41', 'mp42']);

export function matchesMediaSignature(mimeType: SupportedMediaType, bytes: Uint8Array) {
	switch (mimeType) {
		case 'image/jpeg':
			return bytesMatch(bytes, 0, [0xff, 0xd8, 0xff]);
		case 'image/png':
			return bytesMatch(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		case 'image/gif':
			return asciiAt(bytes, 0, 6) === 'GIF87a' || asciiAt(bytes, 0, 6) === 'GIF89a';
		case 'image/webp':
			return asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP';
		case 'image/avif':
			return isoBaseMediaBrands(bytes).some((brand) => brand === 'avif' || brand === 'avis');
		case 'video/mp4':
			return isoBaseMediaBrands(bytes).some((brand) => mp4Brands.has(brand));
		case 'video/webm':
			return bytesMatch(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3]);
	}
}

export function uploadedObjectMetadataMatches(
	expected: { byteSize: number; mimeType: SupportedMediaType },
	actual: { contentType?: string; size: number },
) {
	return expected.byteSize === actual.size && expected.mimeType === actual.contentType;
}

interface R2SigningConfiguration {
	accessKeyId: string;
	accountId: string;
	bucketName: string;
	secretAccessKey: string;
}

interface SignUploadOptions extends R2SigningConfiguration {
	contentType: SupportedMediaType;
	now?: Date;
	objectKey: string;
}

function awsDate(date: Date) {
	return date.toISOString().replace(/[:-]|\.\d{3}/gu, '');
}

export async function signUploadUrl({
	accessKeyId,
	accountId,
	bucketName,
	contentType,
	now = new Date(),
	objectKey,
	secretAccessKey,
}: SignUploadOptions) {
	if (!accessKeyId || !secretAccessKey || !accountId || !bucketName) {
		throw new Error('R2 upload signing is not configured');
	}

	const client = new AwsClient({
		accessKeyId,
		region: 'auto',
		secretAccessKey,
		service: 's3',
	});
	const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
	const endpoint = new URL(
		`https://${accountId}.r2.cloudflarestorage.com/${encodeURIComponent(bucketName)}/${encodedKey}`,
	);
	endpoint.searchParams.set('X-Amz-Expires', String(UPLOAD_URL_LIFETIME_SECONDS));

	const signedRequest = await client.sign(
		new Request(endpoint, {
			headers: {
				'Content-Type': contentType,
				'If-None-Match': '*',
			},
			method: 'PUT',
		}),
		{
			aws: {
				allHeaders: true,
				datetime: awsDate(now),
				signQuery: true,
			},
		},
	);

	return {
		expiresAt: new Date(now.getTime() + UPLOAD_URL_LIFETIME_SECONDS * 1000),
		headers: {
			'Content-Type': contentType,
			'If-None-Match': '*',
		},
		uploadUrl: new URL(signedRequest.url),
	};
}
