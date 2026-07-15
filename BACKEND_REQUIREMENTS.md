# LoveNote Backend Requirements

Status: implemented backend baseline for V1  
Last reviewed: July 15, 2026  
Frontend visual and interaction design requirements will be documented separately.

Repository implementation and disposable-environment acceptance are complete. Production Neon/R2 provisioning, Worker secrets/domain setup, deployment, and validation against Cloudflare's deployed CDN remain operational work.

## 1. Purpose

LoveNote is a small collaborative media microblog with anonymous public browsing and a closed group of at most five accounts. The backend must support public and private posts, original image and video uploads, comments, favorites, tags, author controls, and owner moderation without exposing private content through pages, metadata, media URLs, or shared caches.

This document describes the behavior currently implemented in the repository. It is intended to be reviewed as the product contract before production deployment. The final section calls out implemented decisions that may warrant changes.

## 2. V1 system boundaries

The backend is implemented as:

- A server-rendered Astro 7 application running on Cloudflare Workers.
- Astro components and Tailwind CSS without React, shadcn, or another client UI framework.
- Better Auth for username/password authentication and session management.
- Neon Postgres accessed with Drizzle ORM and Neon's HTTP serverless driver.
- One private Cloudflare R2 bucket for original media objects.
- Astro Actions for application mutations.
- Minimal client JavaScript limited to authentication controls, direct-upload handling, media metadata extraction, progress reporting, and the personalized post-controls server island.

The application does not expose a supported public API in V1.

## 3. Account types and access model

### 3.1 Anonymous visitor

An anonymous visitor can:

- Browse active public posts.
- Open active public post detail pages.
- Browse the public media archive.
- Browse tags that are attached to active public posts.
- Read visible comments and favorite counts on active public posts.
- Fetch media belonging to active public posts.

An anonymous visitor cannot:

- View private, hidden, or deleting posts.
- Fetch media or metadata belonging to private, hidden, or deleting posts.
- Create posts, comments, favorites, tags, uploads, or accounts.
- Access account, author, private-feed, or moderation pages.

### 3.2 Member

An active, non-banned member can:

- View active public and private posts.
- View private-post media and comments.
- Use capabilities granted by the owner after the member has changed any temporary password.
- View the member's own hidden posts.

A regular member cannot:

- View another author's hidden post.
- Manage accounts or owner-only post moderation.
- Transfer or acquire the owner role.
- Use a revoked capability, even from a session established before revocation.

### 3.3 Owner

There is exactly one owner in V1. The owner:

- Is represented internally by Better Auth's `admin` role.
- Always has every application capability, regardless of permission-row values.
- Can create members, set their initial capabilities, change their capabilities, ban or unban them, reset their passwords, and revoke all of their sessions.
- Can view, hide, restore, and permanently delete every post.
- Can moderate all comments.
- Can create, edit, and merge tags.
- Can run expired-upload cleanup.

The owner cannot be transferred, demoted, banned, or managed through the member-management interface in V1.

### 3.4 Content visibility matrix

| Content state | Anonymous | Active member | Author | Owner |
| --- | --- | --- | --- | --- |
| Active public post | Yes | Yes | Yes | Yes |
| Active private post | No | Yes | Yes | Yes |
| Hidden post | No | No | Yes | Yes |
| Deleting post | No | No | No | No |
| Public-post media | Yes | Yes | Yes | Yes |
| Private-post media | No | Yes | Yes | Yes |
| Hidden-post media | No | No | Yes | Yes |

Banned users are treated as unauthenticated for application authorization.

## 4. Authentication and account lifecycle

### 4.1 Sign-in model

- The user-facing login identifier is a username only.
- Usernames are 3–30 characters and may contain letters, numbers, underscores, and periods.
- Usernames are stored in normalized lowercase form while retaining a display form.
- Better Auth uses an internal, non-user-facing email value because its credential account model requires one.
- Passwords must contain 12–128 characters.
- Authentication cookies are secure when the canonical site URL uses HTTPS.
- Authentication rate limiting is enabled and stored in Postgres.
- Cloudflare's connecting-IP header is used for client IP detection.
- Only the configured canonical site origin is trusted.

The following public authentication features are disabled:

- Public registration.
- Email-based sign-in.
- Email verification.
- Email change.
- Username-availability probing.
- Password-reset email flows.
- OAuth providers.

### 4.2 One-time owner setup

- `/setup` is never cacheable.
- Setup is available only while no owner/setup state exists and the user table is empty.
- The submitted setup secret must match `SETUP_SECRET` using constant-time verification.
- Setup creates the sole owner and marks setup initialized atomically.
- Concurrent or repeated setup attempts must not create another owner.
- After successful setup, later visits report that setup is complete.

### 4.3 Member creation

- Only the owner can create a member.
- The site may contain at most five accounts total, including the owner.
- The owner supplies a username, a temporary password, and initial capability values.
- If Better Auth creates an account but the application permission record cannot be created, the backend attempts to remove the incomplete account.
- If incomplete-account removal also fails, the account is banned for safety and the failure is logged.

### 4.4 Temporary passwords

- New members start with `temporaryPassword = true`.
- A temporary-password member remains an active member and can read private content.
- All capability-based mutations are blocked until the temporary password is changed.
- The account page clearly requires the password change.
- A successful password change clears the temporary-password flag immediately.
- The current session remains active after a normal member password change.

### 4.5 Owner account controls

The owner can:

- Change any regular member's capabilities.
- Revoke all active sessions without changing the password.
- Ban a member and invalidate all active sessions.
- Restore sign-in access by unbanning a member.
- Replace a member's password with another temporary password, revoke sessions, and require another password change.

Owner controls must re-check the acting user's current owner status and the target account's manageability on every request.

### 4.6 Owner recovery

- `pnpm owner:recover` resets the sole owner's password without email.
- The password is accepted through a hidden interactive prompt or standard input, never a command argument.
- Recovery requires exactly one owner credential account.
- Recovery updates the password and revokes every owner session atomically.
- The script refuses to proceed when the database URL is missing or the sole owner cannot be identified safely.

## 5. Capabilities

Each regular member has an explicit permission record containing these independently revocable capabilities:

| Capability | Effect | New-member default |
| --- | --- | --- |
| Create posts | Create text and/or media posts | On |
| Edit own posts | Change own post text, visibility, and tags | On |
| Hide/restore own posts | Change own post between active and hidden | On |
| Permanently delete own posts | Start or retry hard deletion of own posts | On |
| Upload images | Request and complete supported image uploads | On |
| Upload videos | Request and complete supported video uploads | On |
| Create comments | Comment on visible posts | On |
| Favorite posts | Add or remove a favorite on visible posts | On |
| Manage tags | Create, update, merge, and retry cache purges for tags | Off |
| Moderate comments | Hide, restore, delete, and retry purges for comments | Off |

Authorization requirements:

- The owner always passes capability checks.
- A regular member must be active, have a non-temporary password, and have the relevant current capability.
- Capabilities are loaded from Postgres for each request; revocation applies to an existing session immediately.
- Every action repeats authorization and ownership checks server-side.
- UI visibility is not considered an authorization boundary.

## 6. Posts

### 6.1 Post content

- A post has a numeric public ID.
- A post may contain text only, media only, or text and media.
- A post must have non-whitespace text or at least one valid completed attachment.
- Text is plain text and is limited to 10,000 characters.
- Windows and classic-Mac line endings are normalized to line feeds.
- Markup is escaped by server rendering.
- Line breaks are preserved.
- Only HTTP and HTTPS URL-like text is turned into links.
- Generated links use `rel="nofollow ugc"`.
- Link parsing excludes unsafe schemes and handles common trailing punctuation.

### 6.2 Visibility and state

Post visibility is one of:

- `public`: visible anonymously while active.
- `private`: visible to every active signed-in member while active.

Post status is one of:

- `active`: available according to visibility.
- `hidden`: available only to the author and owner.
- `deleting`: unavailable to all browsing queries while cleanup is pending.

New posts default to private in the author interface.

### 6.3 Creation and editing

- A creator may attach up to four distinct ready assets owned by that creator.
- A creator may assign up to 30 distinct existing tags.
- Post creation and attachment/tag association occur atomically.
- Expired, pending, missing, already-attached, or foreign assets are rejected.
- Missing or invalid tag IDs cause the creation request to fail rather than silently dropping tags.
- Authors with permission can edit only their own non-deleting posts.
- Editing may change text, public/private visibility, and assigned tags.
- Existing media attachments and their order are unchanged by editing.
- A text-free post can remain text-free only when it already has media.
- Ownership, state, and the text-or-media invariant are enforced in the mutation query.

### 6.4 Hide and restore

- A permitted author can hide or restore the author's own post.
- The owner can hide or restore any post.
- Hiding immediately removes a post from public/private browsing except for author/owner access.
- Hiding public media rotates its delivery revision and invalidates the former media URL.
- Restoring returns the post to its existing public/private visibility.
- Repeating the same lifecycle operation is safe and can retry cache invalidation.

### 6.5 Permanent deletion

Permanent deletion is staged to avoid visible database records pointing at missing media:

1. The target post is locked and marked `deleting`.
2. It disappears from all browsing queries.
3. Affected HTML and former media cache entries are purged.
4. R2 objects are deleted.
5. The Postgres post row is deleted, cascading tags, comments, favorites, and media metadata.

Additional requirements:

- Authors need the delete-own-posts capability to delete their own posts.
- The owner can delete any post.
- Permanent deletion requires explicit confirmation.
- A cache, storage, or database failure leaves a retryable `deleting` record.
- Retrying deletion resumes from stored metadata and is idempotent.
- Operators must not manually delete a pending database row before its R2 cleanup succeeds.

## 7. Media uploads

### 7.1 Supported media

| Kind | Accepted types | Maximum size |
| --- | --- | --- |
| Image | JPEG, PNG, WebP, GIF, AVIF | 50 MiB |
| Video | MP4, WebM | 250 MiB |

The backend rejects:

- Empty files.
- Unsupported MIME types, including SVG, HEIC, and MOV.
- Filenames over 255 characters or containing path/control characters.
- A filename extension that does not match the declared MIME type.
- Image metadata containing a video duration.
- Video metadata without a positive duration.
- Invalid or non-positive dimensions.
- Files whose leading signature/container bytes do not match the declared type.
- Completed R2 objects whose size or content type differs from the upload request.

Alt text is plain text and limited to 1,000 characters.

### 7.2 Direct-upload flow

1. Browser code validates the selected file and extracts dimensions or video duration.
2. An authenticated upload action re-validates metadata and the current image/video capability.
3. The backend creates a pending metadata record with an unguessable UUID and private R2 object key.
4. The backend returns a content-type-bound R2 PUT URL that expires after 10 minutes.
5. The signed PUT requires `If-None-Match: *` so it cannot overwrite an existing object.
6. The browser uploads directly to R2 and reports byte progress.
7. The completion action performs an R2 HEAD and reads signature bytes from the object.
8. The completion action verifies authoritative type, size, signature, ownership, state, and expiry.
9. A verified object becomes ready and returns its attachment ID.
10. Post creation atomically attaches only ready assets owned by the author.

Media bytes never pass through or reside in Postgres.

### 7.3 Abandoned upload cleanup

- Unattached uploads expire 24 hours after being requested.
- Later upload requests opportunistically clean up to 25 expired objects.
- The owner can clean up to 100 expired objects per operation from `/owner/posts`.
- R2 deletion happens before metadata deletion.
- Failed R2 cleanup keeps the metadata row retryable and emits a structured failure event.

## 8. Media delivery

### 8.1 Route and authorization

Media is served only through:

`/media/{asset UUID}/{delivery revision}/{exact encoded original filename}`

The route must:

- Accept only GET and HEAD.
- Require an exact lowercase UUID, positive safe revision, and exact original filename.
- Look up authorization from the associated post on every uncached request.
- Return the same generic 404 for malformed, missing, stale, unauthorized, private, or hidden media probes.
- Never reveal an R2 key.
- Return 503 when R2 metadata unexpectedly disagrees with the database rather than serving uncertain bytes.

### 8.2 HTTP behavior

- Full GET and HEAD responses include content type, content length, ETag, last-modified time, byte-range support, and `nosniff`.
- Single byte ranges, open-ended ranges, and suffix ranges are supported.
- Valid ranges return 206 with a correct `Content-Range`.
- Unsatisfiable or malformed ranges return 416 without media bytes.
- `If-Match`, `If-Unmodified-Since`, `If-None-Match`, `If-Modified-Since`, and `If-Range` are supported.
- Matching cache validators may return 304.
- Failed preconditions return 412.
- Range, HEAD, and conditional responses are not placed in the shared Astro route cache.

### 8.3 Media caching and revocation

- Active public media uses `public, max-age=31536000, immutable`.
- Private, hidden, error, and authorization-sensitive responses use `private, no-store`.
- Only unconditional full public GET responses are eligible for shared caching.
- Public media cache entries are tagged by asset ID and delivery revision.
- Reducing access rotates the revision and synchronously attempts to purge the former public entry.
- An already-downloaded browser copy cannot be remotely revoked; revision rotation and edge purging prevent later access through the application/CDN.

## 9. Tags

- Tag display names are required and limited to 64 characters.
- Slugs are required, unique, lowercase, and limited to 64 characters.
- Slugs are normalized with Unicode decomposition, diacritic removal, lowercase conversion, punctuation-to-hyphen conversion, and edge-hyphen trimming.
- Descriptions are optional plain text and limited to 1,000 characters.
- A post may have at most 30 distinct tags.
- Tags apply to the whole post, not individual attachments.
- The public tag index lists only tags used by active public posts.
- Public tag counts include only active public posts.
- A tag archive contains only active public posts and uses cursor pagination.
- A tag manager can update display name, slug, and description.
- Updating a slug invalidates both the former archive and every affected public post/detail listing.
- Merging moves all source associations to the target, deduplicates existing target associations, permanently deletes the source tag, and invalidates both archives and affected posts.
- There is no standalone tag-delete operation in V1; unused tags remain manageable until merged or removed administratively from the database.

## 10. Comments

- Comment text is required, plain text, and limited to 2,000 characters.
- A commenter must be active, have changed any temporary password, and hold the create-comments capability.
- Comments can be created only on posts visible to the commenter.
- Comments on public posts are immediately public while visible.
- Comments on private posts remain available only to authorized members through the private post.
- Hidden or deleting posts cannot receive comments from ordinary members.
- Comment status is `visible` or `hidden`.
- The owner or a member with comment-moderation capability can hide, restore, or permanently delete comments.
- Comment moderation re-checks the associated post and moderator authorization on every request.
- Public post-detail caches are invalidated after comment creation or moderation.
- Failed moderation cache purges can be retried from the moderation interface.
- Authors do not currently have a separate edit/delete-own-comment workflow unless they also have moderation capability.

## 11. Favorites

- Favoriting requires an active member with a non-temporary password and the favorite-posts capability.
- A member may favorite only a post visible to that member.
- A user/post pair is unique.
- The action toggles the favorite atomically and detects concurrent conflicts.
- Favorite counts are public for active public posts.
- Private-post counts remain inside authenticated private responses.
- Post detail caches are invalidated after a successful toggle.
- The application does not expose favorite-user lists or a public social graph.

## 12. Server-rendered routes

### 12.1 Public routes

| Route | Requirement |
| --- | --- |
| `/` | Newest-first active public feed, 20 posts per cursor page |
| `/posts/{id}` | Visible post detail, attachments, tags, favorite count, and visible comments |
| `/archive` | Newest-first public attachment grid, 40 assets per cursor page |
| `/tags` | Tags with active public posts and public counts |
| `/tags/{slug}` | Newest-first active public posts for one tag, 20 per cursor page |
| `/login` | Username/password login; never shared or cached |
| `/setup` | One-time owner setup; never shared or cached |
| `/media/...` | Authorized original-media delivery |

Public cursor pagination uses opaque URL-safe base64 payloads containing `(createdAt, id)`. Invalid or repeated cursor parameters redirect to the canonical first page instead of producing ambiguous queries.

### 12.2 Protected routes

| Route | Requirement |
| --- | --- |
| `/account` | Password change and session logout controls |
| `/private` | Newest-first active public/private member feed |
| `/manage` | Post composer and the author's 50 newest posts |
| `/manage/posts/{id}` | Edit one owned, non-deleting post |
| `/owner/users` | Account, capability, ban, password, and session controls |
| `/owner/posts` | Owner view of the newest 100 posts and deletion/upload retries |
| `/owner/comments` | Newest 100 comments for moderation |
| `/owner/tags` | Tag metadata and merge tools |

Protected pages:

- Redirect unauthenticated users to login where appropriate.
- Return a forbidden state when a signed-in user lacks a delegated capability.
- Use `private, no-store` and disable Astro route caching.
- Never rely on page middleware alone for mutation authorization.

### 12.3 Personalized controls

- Public post HTML and visible comments remain cacheable.
- Login-aware favorite and comment controls are rendered as a deferred Astro server island.
- The personalized fragment is not stored in the public page cache.
- Core public browsing and standard form navigation work without client-side navigation.
- Text-only post creation and ordinary HTML forms work with JavaScript disabled.
- Direct media uploads require JavaScript.

## 13. Database requirements

### 13.1 Better Auth tables

The schema includes Better Auth's user, session, account, verification, and database rate-limit tables. Sessions and credential accounts cascade when their user is deleted.

### 13.2 Application tables

| Table | Purpose |
| --- | --- |
| `setup_state` | Records one-time initialization |
| `member_permissions` | Capabilities and temporary-password state per user |
| `posts` | Text, author, visibility, lifecycle state, timestamps |
| `media_assets` | R2 key, authoritative metadata, association/order, delivery revision, expiry |
| `tags` | Unique normalized metadata |
| `post_tags` | Unique post/tag associations |
| `comments` | Author, post, body, moderation state |
| `favorites` | Unique user/post favorites |

Database constraints and queries enforce:

- Post body length.
- Positive media sizes and dimensions.
- Media duration validity.
- At most four attachment-order slots per post.
- One attachment per order position.
- Consistent attached/unattached media state.
- Ready uploads having an ETag.
- Positive delivery revisions.
- Lowercase, non-empty, unique tag slugs.
- Unique post/tag joins.
- Non-empty comments up to 2,000 characters.
- Unique favorites.
- Cascades for post-dependent rows.

Indexes support public chronology, author ownership, media ordering/cleanup/archive, tag archives, comment moderation, and favorite counts.

### 13.3 Migration policy

- Better Auth and application tables share one Drizzle schema source of truth.
- SQL migrations are generated, reviewed, and committed.
- Migrations are applied explicitly with `pnpm db:migrate` before compatible Worker deployment.
- The Worker never applies migrations during startup or a request.
- Production migrations should remain backward compatible with the previous Worker version whenever possible.

## 14. Caching

### 14.1 Public HTML

The Cloudflare Astro cache provider is configured for:

- 60 seconds of freshness.
- 300 seconds of stale-while-revalidate.
- `feed` tags for the public feed.
- `archive` tags for the media archive.
- `tags` for the public tag index.
- `post:{id}` for public post detail.
- `tag:{id}` for tag archives.

### 14.2 Invalidation

Mutations construct narrowly scoped invalidation sets:

- Post creation: feed, archive, tag index, and assigned tag archives when public.
- Post edit: detail plus all current/previously affected public listings and former media revisions.
- Hide/restore/delete: detail, public listings, tag archives, and media revisions as applicable.
- Comments/favorites: the affected post detail.
- Tag update/merge: tag index, source/target tag archives, and every affected public post detail.

Cache-invalidation failures are logged without exposing private data. Destructive operations that require cache safety remain retryable. Local workerd acceptance uses Astro's memory cache because the remote R2 proxy does not provide deployed Cloudflare cache-purge APIs.

## 15. Security requirements

### 15.1 Request and response protections

- Astro same-origin checks protect actions from cross-site form mutations.
- Action request bodies are limited to 128 KiB.
- Server-island request bodies are limited to 64 KiB.
- Authentication and protected responses are marked `private, no-store`.
- Error responses do not include credentials, stack traces, object keys, or private record metadata.

Global security headers include:

- Content Security Policy restricted to the same origin, plus direct connections to Cloudflare R2 upload endpoints.
- `Strict-Transport-Security: max-age=31536000`.
- `X-Content-Type-Options: nosniff`.
- `X-Frame-Options: DENY`.
- `Cross-Origin-Opener-Policy: same-origin`.
- `Cross-Origin-Resource-Policy: same-origin`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- Disabled camera, geolocation, microphone, payment, and USB permissions.
- Disabled framing, plugins/objects, and non-self form targets.

### 15.2 Data isolation

- Public queries filter visibility and lifecycle status in Postgres rather than filtering a mixed result in templates.
- Private/hidden records are excluded from anonymous counts, tag archives, media archives, metadata, and page output.
- Media authorization is derived from the associated post.
- Unauthorized media requests return generic non-cacheable 404 responses.
- Hidden posts are author/owner-only.
- Deleting posts are invisible to every viewer.
- Ownership checks are repeated inside mutation queries to resist stale page state and forged form fields.

### 15.3 Secrets

The Worker requires:

- `DATABASE_URL`.
- `BETTER_AUTH_SECRET`.
- `SETUP_SECRET`.
- `R2_ACCESS_KEY_ID`.
- `R2_SECRET_ACCESS_KEY`.

Non-secret configuration includes the canonical site URL, R2 account ID, bucket name, and Worker bindings. Real secrets belong in Wrangler secrets or ignored local `.dev.vars`, never committed files.

## 16. Observability and operations

- Cloudflare Workers Logs and invocation logs are enabled.
- Authentication, setup, password changes, uploads, post mutations, comments, favorites, tags, member administration, moderation, cache failures, cleanup failures, and unexpected exceptions emit structured JSON events.
- Logs may include internal user, post, comment, tag, or asset IDs needed for diagnosis.
- Logs must not contain post/comment bodies, passwords, setup secrets, auth tokens, presigned URLs, or private R2 object keys.
- Cloudflare Web Analytics must be enabled on the proxied production hostname during production setup; no analytics table exists in Postgres.
- The R2 bucket must remain private with no public `r2.dev` URL.
- R2 CORS permits the canonical upload origins and only the required PUT headers.
- Production deployment follows: restore branch, migration test, explicit migration, Worker deploy, smoke test, log monitoring.
- Worker rollback does not roll back Postgres; backward-compatible migrations and a Neon restore branch are required.

## 17. Verification requirements

Before backend release, the repository must pass:

- `pnpm check`.
- Unit tests for schemas, authorization, visibility, safe link handling, upload/media validation, cache tags, cleanup, and mutation-query construction.
- Real-Postgres integration tests on an empty disposable Neon database.
- A production Worker build.
- Playwright acceptance tests against a workerd preview using disposable Neon and private R2 resources.
- `wrangler deploy --dry-run` packaging.

The current implemented baseline has been verified with:

- 211 unit tests across 33 files.
- 7 real-Neon integration tests.
- 29 workerd/Playwright acceptance scenarios.
- Direct R2 image/video uploads and cleanup.
- Secure private media delivery and anonymous denial.
- GET, HEAD, range, conditional, stale-revision, and metadata-mismatch media behavior.
- Public-to-private cache purging and delivery revision rotation.
- Anonymous browsing with JavaScript disabled.
- Member posts, comments, favorites, lifecycle controls, and capability revocation.
- Owner moderation, member session revocation, bans, tag lifecycle, and temporary-password onboarding.

## 18. Intentional V1 omissions

The backend intentionally excludes:

- Public registration.
- Email delivery, email verification, and email password recovery.
- OAuth.
- Account role transfer or multiple owners.
- Public author profiles.
- Public APIs.
- Search.
- Rich text or user-authored HTML.
- Follows, reposts, direct messages, notifications, and favorite-user lists.
- Tag aliases.
- Queues, cron triggers, Durable Objects, and WebSockets.
- Image resizing or responsive variants.
- EXIF/GPS stripping.
- Video transcoding or poster generation.
- Public R2 object URLs.

## 19. Implemented decisions to review

These are not unfinished code paths. They are current product decisions that should be confirmed or changed before production.

1. **Private audience:** Every active account, including a member still using a temporary password, can read all private posts. Temporary-password state blocks interactions, not private reading.
2. **Account limit:** The total site limit is five accounts including the owner.
3. **Owner model:** There is one permanent owner. Ownership cannot be transferred through the application.
4. **Account removal:** The owner can ban members, reset passwords, and revoke sessions, but there is no owner-facing permanent member deletion control.
5. **Post deletion:** Permanent deletion has no trash or retention window once R2/database cleanup completes.
6. **Attachment editing:** After a post is published, its text, visibility, and tags can change, but attachments, order, filenames, and alt text cannot be edited or replaced.
7. **Original files:** Originals are preserved, including EXIF/GPS metadata. Authors must remove sensitive metadata before uploading.
8. **Media compatibility:** Server validation confirms supported MIME types, extensions, sizes, metadata, and file/container signatures. It does not transcode or fully decode files to guarantee every browser supports the embedded codec.
9. **Upload resilience:** Uploads are single direct PUT requests with progress. There is no multipart upload, pause/resume, or automatic retry protocol.
10. **Public comments:** Comments on public posts appear immediately without an approval queue.
11. **Comment ownership:** Comment authors do not have edit/delete-own-comment controls unless they also have moderation capability.
12. **Tags:** Tags can be created, edited, and merged. There is no standalone delete for an unused tag.
13. **Media transformations:** There are no thumbnails, responsive variants, video posters, or transcoding, so page weight depends on author-prepared originals.
14. **Already downloaded media:** Changing public content to private rotates URLs and purges Cloudflare, but cannot revoke copies already saved by a visitor or browser cache.
15. **Cache provider:** Production public caching uses Astro's experimental Cloudflare cache provider behind the repository's small cache/invalidation layer.
16. **Recovery:** Members depend on the owner for password resets; the owner depends on the local recovery command. There is no email recovery.
