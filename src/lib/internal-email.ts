const internalEmailDomain = 'users.invalid';

export function createInternalEmail() {
	return `${crypto.randomUUID()}@${internalEmailDomain}`;
}

export function isInternalEmail(email: string) {
	return email.endsWith(`@${internalEmailDomain}`);
}
