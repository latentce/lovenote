import { describe, expect, it, vi } from 'vitest';

import { deleteR2Objects } from './r2-cleanup';

describe('R2 cleanup', () => {
	it('batch-deletes unique object keys and awaits completion', async () => {
		const deleteObjects = vi.fn().mockResolvedValue(undefined);

		await deleteR2Objects(
			{ delete: deleteObjects },
			['private/first', 'private/first', 'private/second'],
		);

		expect(deleteObjects).toHaveBeenCalledOnce();
		expect(deleteObjects).toHaveBeenCalledWith(['private/first', 'private/second']);
	});

	it('does not call R2 for a text-only post', async () => {
		const deleteObjects = vi.fn().mockResolvedValue(undefined);

		await deleteR2Objects({ delete: deleteObjects }, []);

		expect(deleteObjects).not.toHaveBeenCalled();
	});
});
