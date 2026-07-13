import { describe, expect, it } from 'vitest';

import { decodeArchiveCursor, encodeArchiveCursor } from './archive';

describe('archive cursors', () => {
	it('round-trips a media chronology cursor', () => {
		const cursor = {
			createdAt: new Date('2026-07-13T18:00:00.000Z'),
			id: '0198a34b-2f56-7c8d-9e01-123456789abc',
		};

		expect(decodeArchiveCursor(encodeArchiveCursor(cursor))).toEqual(cursor);
	});

	it.each([
		undefined,
		'',
		'not-base64',
		btoa(JSON.stringify(['2026-07-13T18:00:00.000Z', 'not-a-uuid'])),
	])('rejects an invalid cursor', (value) => {
		expect(decodeArchiveCursor(value)).toBeNull();
	});
});
