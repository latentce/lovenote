/// <reference path="../.astro/types.d.ts" />
/// <reference types="@cloudflare/workers-types" />
/// <reference path="../worker-configuration.d.ts" />

declare namespace Cloudflare {
	interface Env {
		DATABASE_URL: string;
		BETTER_AUTH_SECRET: string;
		SETUP_SECRET: string;
		R2_ACCESS_KEY_ID: string;
		R2_SECRET_ACCESS_KEY: string;
	}
}

declare namespace App {
	interface Locals {
		auth: import('./lib/auth').Auth;
		cfContext: ExecutionContext;
		database: import('./db/client').Database;
		permissions: import('./lib/authorization').MemberPermissions | null;
		session: import('./lib/auth').AuthenticatedSession | null;
		user: import('./lib/auth').AuthenticatedUser | null;
	}
}
