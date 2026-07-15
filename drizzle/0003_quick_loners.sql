CREATE TABLE "cache_purge_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"operation" varchar(64) NOT NULL,
	"post_id" integer,
	"tags" text[] NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"last_error_type" varchar(128) NOT NULL,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cache_purge_jobs_tags_check" CHECK (cardinality("cache_purge_jobs"."tags") > 0),
	CONSTRAINT "cache_purge_jobs_attempt_count_check" CHECK ("cache_purge_jobs"."attempt_count" > 0)
);
--> statement-breakpoint
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_duration_check";--> statement-breakpoint
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_attachment_pair_check";--> statement-breakpoint
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_ready_etag_check";--> statement-breakpoint
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_dimensions_check";--> statement-breakpoint
ALTER TABLE "media_assets" ALTER COLUMN "width" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ALTER COLUMN "height" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "cache_purge_jobs_created_idx" ON "cache_purge_jobs" USING btree ("created_at","id");--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_kind_metadata_check" CHECK (("media_assets"."kind" = 'image' and "media_assets"."duration_ms" is null) or ("media_assets"."kind" = 'video' and "media_assets"."duration_ms" > 0));--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_kind_mime_check" CHECK (("media_assets"."kind" = 'image' and "media_assets"."mime_type" in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif')) or ("media_assets"."kind" = 'video' and "media_assets"."mime_type" in ('video/mp4', 'video/webm')));--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_kind_size_check" CHECK (("media_assets"."kind" = 'image' and "media_assets"."byte_size" <= 52428800) or ("media_assets"."kind" = 'video' and "media_assets"."byte_size" <= 262144000));--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_filename_not_empty_check" CHECK (char_length("media_assets"."original_filename") > 0);--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_state_check" CHECK ((
					"media_assets"."upload_state" = 'pending'
					and "media_assets"."post_id" is null
					and "media_assets"."attachment_order" is null
					and "media_assets"."etag" is null
					and "media_assets"."expires_at" is not null
				) or (
					"media_assets"."upload_state" = 'ready'
					and "media_assets"."etag" is not null
					and (
						("media_assets"."post_id" is null and "media_assets"."attachment_order" is null and "media_assets"."expires_at" is not null)
						or ("media_assets"."post_id" is not null and "media_assets"."attachment_order" is not null and "media_assets"."expires_at" is null)
					)
				));--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_dimensions_check" CHECK ("media_assets"."width" between 1 and 100000 and "media_assets"."height" between 1 and 100000);--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_display_name_not_empty_check" CHECK (char_length("tags"."display_name") > 0);--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_description_length_check" CHECK (char_length("tags"."description") <= 1000);