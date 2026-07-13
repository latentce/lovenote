import type { AuthenticatedUser } from './auth';
import type { memberPermissions } from '../db/schema';

export const capabilities = [
	'createPosts',
	'editOwnPosts',
	'hideOwnPosts',
	'deleteOwnPosts',
	'uploadImages',
	'uploadVideos',
	'createComments',
	'favoritePosts',
	'manageTags',
	'moderateComments',
] as const;

export type Capability = (typeof capabilities)[number];
export type MemberPermissions = typeof memberPermissions.$inferSelect;

export interface AuthorizationContext {
	permissions: MemberPermissions | null;
	user: AuthenticatedUser | null;
}

export type AuthorizationErrorCode =
	| 'AUTHENTICATION_REQUIRED'
	| 'CAPABILITY_REQUIRED'
	| 'OWNER_REQUIRED'
	| 'PASSWORD_CHANGE_REQUIRED';

export class AuthorizationError extends Error {
	readonly code: AuthorizationErrorCode;
	readonly status: 401 | 403;

	constructor(code: AuthorizationErrorCode, status: 401 | 403) {
		super(code);
		this.name = 'AuthorizationError';
		this.code = code;
		this.status = status;
	}
}

function rolesFor(user: AuthenticatedUser) {
	if (Array.isArray(user.role)) {
		return user.role;
	}

	return user.role?.split(',').map((role) => role.trim()) ?? [];
}

export function isActiveMember(user: AuthenticatedUser | null): user is AuthenticatedUser {
	return user !== null && user.banned !== true;
}

export function isOwner(user: AuthenticatedUser | null) {
	return isActiveMember(user) && rolesFor(user).includes('admin');
}

export function canViewPrivateContent(user: AuthenticatedUser | null) {
	return isActiveMember(user);
}

export function hasCapability(
	{ permissions, user }: AuthorizationContext,
	capability: Capability,
) {
	if (!isActiveMember(user)) {
		return false;
	}

	if (isOwner(user)) {
		return true;
	}

	return permissions?.temporaryPassword === false && permissions[capability] === true;
}

export function requireMember({ user }: AuthorizationContext) {
	if (!isActiveMember(user)) {
		throw new AuthorizationError('AUTHENTICATION_REQUIRED', 401);
	}

	return user;
}

export function requireOwner(context: AuthorizationContext) {
	const user = requireMember(context);

	if (!isOwner(user)) {
		throw new AuthorizationError('OWNER_REQUIRED', 403);
	}

	return user;
}

export function requireCapability(context: AuthorizationContext, capability: Capability) {
	const user = requireMember(context);

	if (context.permissions?.temporaryPassword === true && !isOwner(user)) {
		throw new AuthorizationError('PASSWORD_CHANGE_REQUIRED', 403);
	}

	if (!hasCapability(context, capability)) {
		throw new AuthorizationError('CAPABILITY_REQUIRED', 403);
	}

	return user;
}
