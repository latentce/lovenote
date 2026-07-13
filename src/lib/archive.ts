import { z } from 'zod';

export interface ArchiveCursor {
	createdAt: Date;
	id: string;
}

const cursorPayloadSchema = z.tuple([z.iso.datetime({ offset: true }), z.uuid()]);

export function encodeArchiveCursor({ createdAt, id }: ArchiveCursor) {
	return btoa(JSON.stringify([createdAt.toISOString(), id]))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/u, '');
}

export function decodeArchiveCursor(value: string | null | undefined): ArchiveCursor | null {
	if (!value) {
		return null;
	}

	try {
		const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
		const padding = '='.repeat((4 - (base64.length % 4)) % 4);
		const payload = cursorPayloadSchema.parse(JSON.parse(atob(base64 + padding)));

		return { createdAt: new Date(payload[0]), id: payload[1] };
	} catch {
		return null;
	}
}
