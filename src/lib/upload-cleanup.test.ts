import { describe, expect, it, vi } from 'vitest';

import { cleanupExpiredUploadBatch } from './upload-cleanup';

const uploads = [
	{ id: 'first-id', objectKey: 'uploads/first' },
	{ id: 'second-id', objectKey: 'uploads/second' },
];

describe('expired upload cleanup', () => {
	it('deletes R2 objects before removing their metadata', async () => {
		const operations: string[] = [];
		const bucket = {
			delete: vi.fn(async () => {
				operations.push('r2');
			}),
		};
		const deleteMetadata = vi.fn(async (assetIds: string[]) => {
			operations.push('database');
			return assetIds.map((id) => ({ id }));
		});

		await expect(cleanupExpiredUploadBatch(bucket, uploads, deleteMetadata)).resolves.toEqual({
			deleted: 2,
			found: 2,
		});
		expect(bucket.delete).toHaveBeenCalledWith(['uploads/first', 'uploads/second']);
		expect(deleteMetadata).toHaveBeenCalledWith(['first-id', 'second-id']);
		expect(operations).toEqual(['r2', 'database']);
	});

	it('retains metadata when R2 deletion fails', async () => {
		const deleteMetadata = vi.fn();
		const bucket = { delete: vi.fn().mockRejectedValue(new Error('R2 unavailable')) };

		await expect(cleanupExpiredUploadBatch(bucket, uploads, deleteMetadata)).rejects.toThrow(
			'R2 unavailable',
		);
		expect(deleteMetadata).not.toHaveBeenCalled();
	});

	it('does no work for an empty batch', async () => {
		const bucket = { delete: vi.fn() };
		const deleteMetadata = vi.fn();

		await expect(cleanupExpiredUploadBatch(bucket, [], deleteMetadata)).resolves.toEqual({
			deleted: 0,
			found: 0,
		});
		expect(bucket.delete).not.toHaveBeenCalled();
		expect(deleteMetadata).not.toHaveBeenCalled();
	});
});
