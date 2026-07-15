import { z } from 'zod';

const requiredSecrets = [
	'BETTER_AUTH_SECRET',
	'DATABASE_URL',
	'R2_ACCESS_KEY_ID',
	'R2_SECRET_ACCESS_KEY',
	'SETUP_SECRET',
] as const;

const r2BindingSchema = z.object({
	binding: z.string(),
	bucket_name: z.string().min(1),
	remote: z.boolean().optional(),
});

const configSchema = z.object({
	compatibility_date: z.iso.date(),
	env: z.object({
		acceptance: z.object({
			r2_buckets: z.array(r2BindingSchema),
			secrets: z.object({ required: z.array(z.string()) }),
			vars: z.object({ R2_BUCKET_NAME: z.string() }),
		}),
	}),
	observability: z.object({ enabled: z.literal(true) }),
	r2_buckets: z.array(r2BindingSchema),
	secrets: z.object({ required: z.array(z.string()) }),
	vars: z.object({
		R2_ACCOUNT_ID: z.string(),
		R2_BUCKET_NAME: z.string(),
		SITE_URL: z.string(),
	}),
});

function exactBinding(bindings: z.infer<typeof r2BindingSchema>[], name: string) {
	return bindings.find(({ binding }) => binding === name);
}

function assertRequiredSecrets(actual: string[], label: string) {
	const missing = requiredSecrets.filter((secret) => !actual.includes(secret));
	if (missing.length > 0) throw new Error(`${label} is missing required secrets: ${missing.join(', ')}.`);
}

export function verifyProductionConfig(input: unknown) {
	const config = configSchema.parse(input);
	const productionBinding = exactBinding(config.r2_buckets, 'MEDIA_BUCKET');
	if (!productionBinding) throw new Error('Production must define the MEDIA_BUCKET R2 binding.');
	if (productionBinding.remote === true) {
		throw new Error('Production MEDIA_BUCKET must not opt into Wrangler remote development.');
	}
	if (productionBinding.bucket_name !== config.vars.R2_BUCKET_NAME) {
		throw new Error('Production MEDIA_BUCKET and R2_BUCKET_NAME must name the same bucket.');
	}
	if (config.vars.R2_BUCKET_NAME === 'lovenote-media-test') {
		throw new Error('Production must not use the acceptance R2 bucket.');
	}
	if (!/^[0-9a-f]{32}$/u.test(config.vars.R2_ACCOUNT_ID)) {
		throw new Error('Production R2_ACCOUNT_ID must be a 32-character Cloudflare account ID.');
	}

	const siteUrl = new URL(config.vars.SITE_URL);
	if (siteUrl.protocol !== 'https:' || siteUrl.origin !== config.vars.SITE_URL) {
		throw new Error('Production SITE_URL must be a canonical HTTPS origin without a path or trailing slash.');
	}
	if (siteUrl.hostname === 'lovenote.example.com' || siteUrl.hostname.endsWith('.example.com')) {
		throw new Error('Replace the production SITE_URL example hostname before deployment.');
	}

	assertRequiredSecrets(config.secrets.required, 'Production Wrangler configuration');
	assertRequiredSecrets(config.env.acceptance.secrets.required, 'Acceptance Wrangler configuration');

	const acceptanceBinding = exactBinding(config.env.acceptance.r2_buckets, 'MEDIA_BUCKET');
	if (
		!acceptanceBinding ||
		acceptanceBinding.bucket_name !== 'lovenote-media-test' ||
		acceptanceBinding.remote !== true ||
		config.env.acceptance.vars.R2_BUCKET_NAME !== 'lovenote-media-test'
	) {
		throw new Error('Acceptance must use the remote lovenote-media-test MEDIA_BUCKET binding.');
	}
	if (acceptanceBinding.bucket_name === productionBinding.bucket_name) {
		throw new Error('Production and acceptance R2 buckets must be different.');
	}

	return config;
}
