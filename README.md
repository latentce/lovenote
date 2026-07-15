# LoveNote

LoveNote is a small collaborative media microblog for anonymous public browsing and a closed group of up to five accounts. It runs as a server-rendered Astro 7 application on Cloudflare Workers, stores relational data in Neon Postgres, and keeps original media in a private R2 bucket.

The backend and functional server-rendered screens are the current focus. Visual design will be refined separately.

## Stack

- Astro 7 with the Cloudflare adapter and server output
- Tailwind CSS 4 without a client UI framework
- Better Auth with username/password sign-in and a closed admin-managed account list
- Drizzle ORM over Neon's HTTP serverless driver
- A private Cloudflare R2 bucket with direct, presigned browser uploads
- Vitest for backend tests and Playwright for production-runtime smoke tests

Use pnpm only. The project requires Node.js 22.12 or newer.

## Local development

Install dependencies and copy the committed environment template:

```sh
pnpm install
cp .dev.vars.example .dev.vars
```

Fill `.dev.vars` with development-only values. Never commit that file. Create a separate Neon branch and R2 bucket for development rather than pointing local work at production.

Apply the committed migrations, then start Astro in background mode:

```sh
pnpm db:migrate
pnpm dev
```

Manage the background server with:

```sh
pnpm dev:status
pnpm dev:logs
pnpm dev:stop
```

The first account is created at `/setup`. Setup succeeds only while the user table is empty and requires `SETUP_SECRET`. All later accounts are created by the owner at `/owner/users`.

## Provision production services

### Neon

1. Create a Neon project and production branch.
2. Copy its Postgres connection string into the `DATABASE_URL` Worker secret. The application uses the Neon HTTP driver; no Hyperdrive or WebSocket configuration is needed.
3. Create a temporary Neon branch from production before applying a schema change. Use it to test migrations and as a restore point during the deployment window.

Database migrations are generated and committed with the application:

```sh
pnpm db:generate
```

Review generated SQL before committing it. Apply migrations explicitly before deploying compatible Worker code:

```sh
pnpm db:migrate
```

The Worker never runs migrations during startup or a request.

For local Drizzle commands, `drizzle.config.ts` loads an ignored `.dev.vars` when present. Shell
export syntax is not required for connection strings containing query parameters.

### R2

Create the private media bucket configured in `wrangler.jsonc`:

```sh
pnpm wrangler r2 bucket create lovenote-media
```

Do not enable an `r2.dev` URL or public bucket domain. All reads must pass through `/media/...`, where post visibility is checked.

Create an R2 API token scoped to Object Read & Write for only this bucket. Store its access-key ID and secret as `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. The bucket binding handles authenticated delivery; these credentials are used only to sign short-lived, content-type-bound browser PUT requests.

Edit `config/r2-cors.example.json` so its origins exactly match the production `SITE_URL` and any development origin that should upload. Then apply and verify it:

```sh
pnpm wrangler r2 bucket cors set lovenote-media --file config/r2-cors.example.json
pnpm wrangler r2 bucket cors list lovenote-media
```

The policy intentionally permits only `PUT` with `Content-Type` and `If-None-Match`. Keep the bucket private.

## Worker configuration and secrets

Replace the placeholder values in `wrangler.jsonc`:

- `SITE_URL`: the canonical HTTPS origin, without a trailing slash
- `R2_ACCOUNT_ID`: the Cloudflare account ID that owns the bucket
- `R2_BUCKET_NAME`: the same bucket used by `MEDIA_BUCKET`
- `r2_buckets[0].bucket_name`: the production bucket name

`pnpm config:check` rejects placeholder origins, malformed account IDs, production/test bucket
reuse, missing secret declarations, and an incorrectly isolated acceptance binding. `pnpm deploy`
runs this preflight automatically before it builds or contacts Cloudflare.

Attach the Worker to the proxied production hostname as a Cloudflare Custom Domain or route. `SITE_URL`, the R2 CORS origin, and the browser-visible hostname must agree.

Set secrets interactively so their values do not appear in the command or repository:

```sh
pnpm wrangler secret put DATABASE_URL
pnpm wrangler secret put BETTER_AUTH_SECRET
pnpm wrangler secret put SETUP_SECRET
pnpm wrangler secret put R2_ACCESS_KEY_ID
pnpm wrangler secret put R2_SECRET_ACCESS_KEY
```

`BETTER_AUTH_SECRET` must be a high-entropy value of at least 32 characters. `SETUP_SECRET` must be a different high-entropy value. Wrangler validates the required secret names declared in `wrangler.jsonc` before deployment.

Regenerate binding types after any Wrangler binding, variable, or secret declaration changes:

```sh
pnpm typegen
```

Astro's Cloudflare adapter automatically provisions and uses a `SESSION` KV binding for Astro
sessions. It is framework-managed infrastructure; LoveNote authentication remains stored by Better
Auth in Postgres.

## Verify and deploy

Run the full verification sequence:

```sh
pnpm check
pnpm test
pnpm test:worker
pnpm build
pnpm wrangler deploy --dry-run
pnpm audit --audit-level low
```

Database acceptance tests apply every committed migration and exercise constraints, cascades,
pagination, ordering, and visibility against real Postgres. Create a fresh, empty, disposable Neon
branch, then pass only its connection string:

```sh
INTEGRATION_DATABASE_URL='postgresql://...' pnpm test:integration
```

The command refuses to run when that URL is missing or matches `DATABASE_URL`, and the suite stops
before inserting fixtures if any application table is already populated. Delete the disposable
branch after the run.

When `.dev.vars` points to the isolated `lovenote_test` database, this local convenience command
creates or resets a sibling `lovenote_test_integration` database and runs the suite there:

```sh
pnpm test:integration:local
```

It refuses to reset anything unless the source database name ends in `_test`.

For the local production-runtime acceptance suite, prepare an isolated migrated Neon branch and the
`lovenote-media-test` R2 bucket in `.dev.vars`, install Chromium once with
`pnpm exec playwright install chromium`, then run:

```sh
E2E_DATABASE_ISOLATED=1 E2E_MUTATIONS=1 E2E_UPLOADS=1 pnpm test:acceptance
```

Playwright selects the named `acceptance` Wrangler environment automatically. Its `MEDIA_BUCKET`
binding is remote and points only to `lovenote-media-test`; the top-level production binding remains
separate. Local Wrangler must be authenticated, and the test bucket needs the CORS policy from
`config/r2-cors.example.json`. Keep `R2_BUCKET_NAME` in `.dev.vars` set to
`lovenote-media-test` so presigned uploads and binding-based verification use the same bucket.
Acceptance preview uses Astro's in-memory cache provider because Cloudflare's remote-binding proxy
does not expose deployed Workers' `cache.purge()` API. Production builds continue to use the
Cloudflare CDN provider; cache-tag construction and purge failure behavior are covered by unit tests.

`pnpm test:acceptance` is the release gate and refuses to run unless every required credential is
present, `E2E_DATABASE_ISOLATED=1`, both mutation/upload flags equal `1`, and the bucket is exactly
`lovenote-media-test`. Set the database marker only after confirming `DATABASE_URL` points to a
disposable database or Neon branch. Configure the same marker as an `E2E_DATABASE_ISOLATED`
environment variable in the protected GitHub `acceptance` environment.
Use `pnpm test:acceptance:smoke` for the explicitly non-mutating subset; it is not a substitute for
the release gate. The local runner loads an ignored `.dev.vars` when it exists. Member coverage uses
`E2E_MEMBER_USERNAME` and `E2E_MEMBER_PASSWORD`; owner coverage uses `E2E_OWNER_USERNAME` and
`E2E_OWNER_PASSWORD`. Use only a disposable member with a non-temporary password. The suite deletes
the posts and R2 objects it creates. Set
`E2E_BASE_URL` to test an already-running preview or deployment instead of starting local workerd.

GitHub Actions runs diagnostics, Node unit tests, local workerd runtime tests, a production build,
binding-generation checks, dry-run packaging, and dependency audit on pushes and pull requests. The
manually dispatched acceptance workflow requires isolated Neon/R2 credentials in the `acceptance`
GitHub environment and runs the real-Postgres and full Playwright gates serially.

For a production change:

1. Create a Neon restore branch and test the migration there.
2. Apply backward-compatible production migrations with `pnpm db:migrate`.
3. Deploy the Worker with `pnpm deploy`.
4. Complete `/setup` only on the first deployment.
5. Verify anonymous browsing, sign-in, private browsing, and one small direct upload.
6. Watch structured logs with `pnpm tail`.

Cloudflare Workers Logs are enabled in `wrangler.jsonc`. Application events are emitted as JSON and avoid post bodies, comments, credentials, presigned URLs, and private R2 keys. Enable Cloudflare Web Analytics for the proxied production hostname in the dashboard; no analytics database tables are required.

## Owner recovery

The owner password can be reset without an email provider. Provide `DATABASE_URL` through a secure environment or shell prompt, then run:

```sh
pnpm owner:recover
```

The command prompts for the password without echoing it, requires 12–128 characters, updates only the sole admin credential, and revokes every owner session atomically. For non-interactive automation it accepts the password on standard input; never pass a password as a command argument.

If the command reports that it did not find exactly one owner, stop and inspect the database rather than changing roles manually.

## Media cleanup and deletion recovery

Pending uploads expire after 24 hours. Later upload requests opportunistically remove expired R2 objects, and the owner can run a larger cleanup batch from `/owner/posts`.

Permanent post deletion is staged:

1. the post becomes `deleting` and disappears from browsing;
2. cached public pages and media URLs are purged;
3. R2 objects are deleted;
4. database rows are removed.

If storage or cache cleanup fails, the deleting record remains available to retry from `/owner/posts`. Do not manually delete the database record first.

## Rollback

List recent Worker versions and roll back application code with Wrangler:

```sh
pnpm wrangler versions list
pnpm wrangler rollback
```

A Worker rollback does not revert Postgres. Prefer backward-compatible migrations so the previous Worker can run against the new schema. If a destructive database change must be reversed, stop writes, restore or promote the pre-deployment Neon branch according to the Neon recovery procedure, update `DATABASE_URL` if the endpoint changed, and only then restore traffic. R2 objects are not versioned by this application; preserve the private bucket during code and database rollback.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the background Astro development server |
| `pnpm dev:stop` / `dev:status` / `dev:logs` | Manage the background server |
| `pnpm typegen` | Generate Cloudflare binding types |
| `pnpm db:auth-schema` | Regenerate Better Auth's Drizzle schema source |
| `pnpm db:generate` | Generate a reviewed SQL migration |
| `pnpm db:migrate` | Apply committed migrations explicitly |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm owner:recover` | Reset the sole owner's password and sessions |
| `pnpm config:check` | Reject unsafe or placeholder production Wrangler configuration |
| `pnpm check` | Run Astro and TypeScript diagnostics |
| `pnpm test` | Run backend tests once |
| `pnpm test:worker` | Run runtime-sensitive tests inside local workerd with emulated bindings |
| `pnpm test:integration` | Apply migrations and run database acceptance tests on a disposable Neon branch |
| `pnpm test:integration:local` | Reset the isolated local integration database and run its tests |
| `pnpm test:watch` | Run backend tests in watch mode |
| `pnpm test:e2e` | Run Playwright against an existing build or `E2E_BASE_URL` |
| `pnpm test:acceptance` | Require full isolated credentials, build, and run every Playwright scenario |
| `pnpm test:acceptance:smoke` | Run only the explicitly non-mutating Playwright subset |
| `pnpm build` | Check and build the production Worker |
| `pnpm preview` | Run the built application in local workerd |
| `pnpm deploy` | Verify and deploy with Wrangler |
| `pnpm tail` | Stream production Worker logs |

## V1 boundaries

V1 intentionally omits queues, cron triggers, Durable Objects, WebSockets, public APIs, public registration, email flows, OAuth, search, rich text, follows, reposts, direct messages, notifications, transcoding, resized thumbnails, EXIF removal, video posters, and public author profiles. Original uploads are preserved, including embedded metadata; authors must remove sensitive EXIF or GPS data before uploading.
