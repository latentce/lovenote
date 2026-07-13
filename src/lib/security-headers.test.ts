import { describe, expect, it } from 'vitest';

import { applySecurityHeaders, securityHeaders } from './security-headers';

describe('runtime security headers', () => {
	it('adds every security header without replacing response metadata', () => {
		const response = applySecurityHeaders(
			new Response('body', {
				headers: { 'Cache-Control': 'private, no-store' },
				status: 202,
			}),
		);

		expect(response.status).toBe(202);
		expect(response.headers.get('Cache-Control')).toBe('private, no-store');
		for (const [name, value] of Object.entries(securityHeaders)) {
			expect(response.headers.get(name)).toBe(value);
		}
	});

	it('overwrites weaker route-level values', () => {
		const response = applySecurityHeaders(
			new Response(null, { headers: { 'X-Frame-Options': 'SAMEORIGIN' } }),
		);

		expect(response.headers.get('X-Frame-Options')).toBe('DENY');
	});
});
