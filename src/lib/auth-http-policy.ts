const publicAuthRoutes = new Map<string, ReadonlySet<string>>([
	['/get-session', new Set(['GET'])],
	['/sign-in/username', new Set(['POST'])],
	['/sign-out', new Set(['POST'])],
]);

export function isPublicAuthRequest(request: Request) {
	const pathname = new URL(request.url).pathname;
	const authPath = pathname.startsWith('/api/auth')
		? pathname.slice('/api/auth'.length) || '/'
		: pathname;

	return publicAuthRoutes.get(authPath)?.has(request.method.toUpperCase()) === true;
}
