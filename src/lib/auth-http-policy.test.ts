import { describe, expect, it } from 'vitest';

import { isPublicAuthRequest } from './auth-http-policy';

function request(path: string, method = 'GET') {
	return new Request(`https://example.com${path}`, { method });
}

describe('public Better Auth HTTP policy', () => {
	it.each([
		['GET', '/api/auth/get-session'],
		['POST', '/api/auth/sign-in/username'],
		['POST', '/api/auth/sign-out'],
	])('allows %s %s', (method, path) => {
		expect(isPublicAuthRequest(request(path, method))).toBe(true);
	});

	it.each([
		['POST', '/api/auth/admin/create-user'],
		['POST', '/api/auth/admin/impersonate-user'],
		['POST', '/api/auth/admin/remove-user'],
		['POST', '/api/auth/admin/set-role'],
		['POST', '/api/auth/admin/set-user-password'],
		['POST', '/api/auth/change-password'],
		['POST', '/api/auth/sign-up/email'],
		['POST', '/api/auth/update-user'],
		['GET', '/api/auth/sign-in/username'],
		['POST', '/api/auth/get-session'],
	])('blocks %s %s', (method, path) => {
		expect(isPublicAuthRequest(request(path, method))).toBe(false);
	});
});
