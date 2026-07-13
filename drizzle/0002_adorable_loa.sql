CREATE TABLE "setup_state" (
	"key" text PRIMARY KEY NOT NULL,
	"initialized_at" timestamp with time zone DEFAULT now() NOT NULL
);
