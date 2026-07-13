export const securityHeaders = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Resource-Policy': 'same-origin',
	'Origin-Agent-Cluster': '?1',
	'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Strict-Transport-Security': 'max-age=31536000',
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
} as const;

export function applySecurityHeaders(response: Response) {
	for (const [name, value] of Object.entries(securityHeaders)) {
		response.headers.set(name, value);
	}

	return response;
}
