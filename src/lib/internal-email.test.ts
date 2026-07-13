import { describe, expect, it } from 'vitest';

import { createInternalEmail, isInternalEmail } from './internal-email';

describe('internal account email addresses', () => {
	it('uses a reserved non-deliverable domain', () => {
		const email = createInternalEmail();

		expect(email).toMatch(/^[0-9a-f-]{36}@users\.invalid$/);
		expect(isInternalEmail(email)).toBe(true);
		expect(isInternalEmail('member@example.com')).toBe(false);
	});

	it('generates a distinct address for every account', () => {
		expect(createInternalEmail()).not.toBe(createInternalEmail());
	});
});
