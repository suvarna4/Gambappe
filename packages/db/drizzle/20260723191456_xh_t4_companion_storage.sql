CREATE TYPE "public"."companion_artifact_kind" AS ENUM('banter', 'callout_draft', 'season_recap');--> statement-breakpoint
CREATE TABLE "companion_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "companion_artifact_kind" NOT NULL,
	"cache_key" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"pairing_id" uuid,
	"season_id" uuid,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companion_ingest_log" (
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companion_ingest_log_source_kind_source_id_pk" PRIMARY KEY("source_kind","source_id")
);
--> statement-breakpoint
ALTER TABLE "companion_artifacts" ADD CONSTRAINT "companion_artifacts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_artifacts" ADD CONSTRAINT "companion_artifacts_pairing_id_nemesis_pairings_id_fk" FOREIGN KEY ("pairing_id") REFERENCES "public"."nemesis_pairings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_artifacts" ADD CONSTRAINT "companion_artifacts_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companion_artifacts_cache_key_uq" ON "companion_artifacts" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "companion_artifacts_profile_kind_created_idx" ON "companion_artifacts" USING btree ("profile_id","kind","created_at");