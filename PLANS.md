# Collaborative Media Microblog V1

## Summary

Build the minimal starter into a server-rendered Astro 7 application optimized for anonymous browsing and a closed group of 1–5 collaborators. Public content is CDN-cacheable; private content requires any active member account; one owner controls users, permissions, moderation, and all content.

The implementation will use Astro components and Tailwind 4 without React or shadcn. Client JavaScript is limited to Better Auth login, direct-upload progress/metadata extraction, and Astro’s small personalized-controls island. The foundation follows the current official guidance for [Astro on Cloudflare Workers](https://docs.astro.build/en/guides/integrations-guide/cloudflare/), [Tailwind 4](https://docs.astro.build/en/guides/styling/), [Astro Actions](https://docs.astro.build/en/guides/actions/), and [Cloudflare route caching](https://docs.astro.build/en/guides/caching/).

## Implementation Changes

### Runtime and project foundation

- Add the Cloudflare adapter with server output, Tailwind 4’s Vite plugin, Wrangler, Astro type checking, Drizzle, Neon’s serverless driver, Better Auth, Zod, and the small `aws4fetch` signer.
- Use Neon HTTP rather than WebSockets or Hyperdrive; it is the simplest serverless connection model for single queries and batched mutations. [Drizzle’s Neon guide](https://orm.drizzle.team/docs/connect-neon)
- Configure one non-public R2 bucket binding. Postgres stores only R2 keys and media metadata.
- Add typed Worker bindings and secrets for Neon, Better Auth, setup authentication, R2 signing, bucket details, and the canonical site URL. Commit examples only, never real secrets.
- Add pnpm-only scripts for background development and control, type generation, checking, testing, migrations, preview, deployment, and log tailing. `pnpm dev` will run `astro dev --background`, with matching stop/status/log scripts.
- Enable strict security headers, CSP, same-origin mutation checks, secure cookies, and structured error responses.

### Authentication and authorization

- Mount Better Auth at `/api/auth/[...all]` using its Astro handler and Drizzle adapter. [Better Auth Astro integration](https://better-auth.com/docs/integrations/astro)
- Enable email/password authentication only; disable public signup, OAuth, email verification, and email password-reset flows.
- Add the Better Auth admin plugin for closed account creation, password changes, bans, and session revocation. [Admin plugin](https://better-auth.com/docs/plugins/admin)
- Implement `/setup` as a one-time flow available only while the user table is empty and only with `SETUP_SECRET`. It creates the sole Better Auth administrator, presented in the UI as the owner. The owner role cannot be transferred or demoted in v1.
- The owner creates members with temporary passwords. Members must change the temporary password after first login. Add a pnpm recovery command for resetting the owner password without an email provider.
- Store an explicit capability record per member:
  - create posts
  - edit own posts
  - hide/restore own posts
  - permanently delete own posts
  - upload images
  - upload videos
  - create comments
  - favorite posts
  - manage tag metadata and merges
  - moderate comments
- New authors default to all own-content, upload, comment, and favorite capabilities; tag management and comment moderation default off. The owner always has every capability.
- Every active, non-banned member can view private posts. Hidden posts are limited to their author and the owner. Every action repeats authorization checks server-side rather than relying only on route middleware.

### Database model and migrations

Use Better Auth’s generated Drizzle tables plus these application tables:

- `member_permissions`: user reference, capability booleans, temporary-password flag, timestamps.
- `posts`: numeric public ID, author, plain-text body, `public|private` visibility, `active|hidden|deleting` status, timestamps.
- `media_assets`: UUID, nullable post during upload, uploader, image/video kind, R2 key, original filename, MIME type, byte size, width, height, video duration, ETag, alt text, attachment order, upload state, delivery revision, expiry, timestamps.
- `tags`: numeric ID, unique case-insensitive slug, display name, description, timestamps.
- `post_tags`: unique post/tag join; tags apply to the whole post.
- `comments`: post, author, plain-text body, `visible|hidden` status, timestamps.
- `favorites`: unique user/post pair and timestamp.

Add indexes for visibility/status/chronology, author ownership, media ordering and cleanup, tag archives, comment lookup, and favorite counts. Use cursor pagination on `(createdAt, id)` rather than offset pagination.

Generate Better Auth’s schema through its pnpm-invoked CLI, keep one Drizzle schema source of truth, commit SQL migrations, and apply them with Drizzle Kit before deployment. Do not run migrations automatically inside the Worker.

### Posts, media, and mutations

- Define grouped Astro Actions for setup, users, posts, uploads, comments, favorites, and tags. Use shared Zod schemas and standard HTML form actions wherever uploads do not require JavaScript.
- A post may contain text only, media only, or text with up to four mixed image/video attachments. Require at least text or one completed attachment.
- Use plain text capped at 10,000 characters. Escape all markup, preserve line breaks, and safely link only HTTP/HTTPS URLs with `rel="nofollow ugc"`.
- Accept JPEG, PNG, WebP, GIF, and AVIF images up to 50 MB; accept MP4 and WebM videos up to 250 MB. Reject SVG, HEIC, MOV, executable content, mismatched MIME types, and unsupported codecs.
- Upload flow:
  1. Vanilla browser code validates the file and extracts dimensions or video duration.
  2. An authenticated action checks capabilities and returns a short-lived, content-type-bound R2 PUT URL.
  3. The browser uploads directly to R2 with progress reporting.
  4. A completion action performs an R2 HEAD, verifies type and size, records authoritative metadata, and returns the attachment ID.
  5. Post creation atomically attaches only ready assets owned by the current user.
- Signed uploads expire after 10 minutes. Unattached assets expire after 24 hours and are removed during later upload operations or through an owner cleanup tool. [Cloudflare’s direct R2 upload pattern](https://developers.cloudflare.com/r2/objects/upload-objects/)
- Serve media through `/media/[assetId]/[revision]/[filename]` from the private bucket. The endpoint checks post status and visibility, supports GET/HEAD/range and conditional requests, and sends correct length, ETag, MIME, and `nosniff` headers.
- Public media receives long CDN caching; private and hidden media use `private, no-store`. Reducing access rotates the delivery revision and synchronously purges the old edge cache.
- Authors may hide/restore and permanently delete their own posts when permitted. Hard deletion first marks the post `deleting`, removes it from browsing and purges caches, then deletes R2 objects and finally cascades database rows. Failed R2 cleanup leaves a retryable deleting record rather than an inconsistent visible post.

## Pages, Moderation, and Performance

### Browsing experience

- `/`: newest-first public post feed, 20 posts per cursor page.
- `/posts/[id]`: public detail page with all attachments, metadata, tags, favorite count, and visible comments.
- `/archive`: attachment-centric media grid, 40 assets per cursor page, linking each asset back to its post.
- `/tags` and `/tags/[slug]`: tag metadata, counts, and newest-first public archives.
- `/login`, `/account`, `/private`, and `/manage`: sign-in, account settings, member-only private feed, and author tools.
- `/owner/users`, `/owner/posts`, `/owner/comments`, and `/owner/tags`: owner administration and moderation.
- Public routes never leak private/hidden records through counts, tags, adjacent-post navigation, page metadata, or media URLs.
- Public comments appear immediately and are readable by everyone on public posts. Private-post comments remain private. Moderators can hide, restore, or permanently delete comments.
- Favorites require permission and authentication. Counts are public for public posts, but favorite-user lists and other social graph features are omitted.

### Rendering and caching

- Build layouts, feeds, cards, forms, galleries, and moderation screens as `.astro` components with Tailwind; add no UI framework integration.
- Public HTML uses Astro’s Cloudflare CDN cache provider with a 60-second freshness window and 5-minute stale-while-revalidate period.
- Tag cache entries as `feed`, `archive`, `post:<id>`, and `tag:<id>`; mutations invalidate only affected content.
- Keep protected pages, private feeds, actions, setup, and personalized fragments uncached.
- Defer a small server island on public detail pages for login-aware favorite/comment controls while keeping the post and comments cacheable.
- Emit intrinsic image dimensions, `decoding="async"`, native lazy loading outside the first visible asset, and `preload="metadata"` for video. Cursor links and browsing work without client-side navigation.
- Because v1 stores and serves originals only, there will be no resized thumbnails, EXIF stripping, video posters, or transcoding. The archive therefore relies on the agreed upload limits and authors preparing reasonably optimized files.

### Operations

- Enable Cloudflare Workers Logs and emit structured JSON for authentication events, uploads, mutations, moderation, cleanup failures, cache purges, and unexpected exceptions without logging bodies, credentials, presigned URLs, or private media keys. [Workers Logs guidance](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- Enable Cloudflare Web Analytics for the proxied production hostname through the Cloudflare dashboard; no application analytics tables are needed. [Web Analytics setup](https://developers.cloudflare.com/web-analytics/get-started/)
- Document Neon/R2 provisioning, R2 CORS, secret setup, migrations, deployment, one-time owner setup, account recovery, cleanup, and rollback.
- Exclude queues, cron triggers, Durable Objects, WebSockets, public APIs, follows, reposts, direct messages, notifications, public registration, rich text, tag aliases, search, transcoding, and public author profiles from v1.

## Test Plan and Acceptance Criteria

- Unit-test Zod limits, all valid post/media combinations, tag normalization, safe URL linking/XSS resistance, capability checks, owner overrides, and visibility rules.
- Database-test clean migration application, unique favorites, tag joins, media ordering, cursor pagination, cascades, and public/private/hidden query isolation.
- Auth-test one-time setup, disabled signup, temporary-password enforcement, bans, session revocation, and owner recovery.
- Upload-test permission failures, MIME/size limits, expired signatures, HEAD mismatches, attachment ownership, abandoned-upload cleanup, mixed attachment ordering, and R2 deletion retries.
- Security-test that anonymous users cannot fetch private media or metadata, members cannot edit others’ posts, hidden posts are author/owner-only, and capability revocation takes effect immediately.
- Cache-test post, comment, favorite, tag, visibility, hide, and delete invalidation—including public-to-private media transitions.
- End-to-end test anonymous public browsing, member private browsing, mixed-media post creation, comments, favorites, author hide/delete behavior, owner moderation, user capability changes, and zero-JavaScript form fallbacks.
- Run `pnpm check`, unit/integration tests, a production Worker build, and Playwright smoke tests against the `workerd` preview before deployment.
- Acceptance requires no React/shadcn runtime, no media bytes in Postgres, no private content in anonymous responses or CDN cache after purge, direct R2 uploads with progress, range-capable video playback, and functional public browsing with JavaScript disabled.

## Assumptions and Defaults

- Private means visible to every active signed-in member, superseding the original admin-only wording.
- The owner is the only account administrator; selected members may receive tag or comment moderation capabilities but cannot manage users.
- Post text is limited to 10,000 characters, comments to 2,000, tags to 30 per post, tag names to 64, and alt text to 1,000.
- Original files—including embedded EXIF/GPS metadata—are preserved. Authors must remove sensitive metadata before uploading.
- Once public media has been delivered, changing it to private cannot revoke copies already downloaded or stored in a visitor’s browser; the application will rotate URLs and purge Cloudflare’s edge cache.
- Cloudflare’s documented Astro cache provider is currently experimental, so its use will be isolated behind a small cache helper and dependencies will be locked through `pnpm-lock.yaml`.
