import { AwsClient } from 'aws4fetch';
import { z } from 'zod';

export const IMAGE_UPLOAD_LIMIT = 50 * 1024 * 1024;
export const VIDEO_UPLOAD_LIMIT = 250 * 1024 * 1024;
export const UPLOAD_URL_LIFETIME_SECONDS = 10 * 60;
export const UNATTACHED_UPLOAD_LIFETIME_MS = 24 * 60 * 60 * 1000;

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
