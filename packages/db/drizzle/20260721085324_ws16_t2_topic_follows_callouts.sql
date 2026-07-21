CREATE TYPE "public"."callout_status" AS ENUM('pending', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TABLE "callouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"challenger_profile_id" uuid NOT NULL,
	"opponent_profile_id" uuid,
	"token_hash" text NOT NULL,
	"status" "callout_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"pairing_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_follows" (
	"profile_id" uuid NOT NULL,
	"category" "market_category" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_follows_profile_id_category_pk" PRIMARY KEY("profile_id","category")
);
--> statement-breakpoint
ALTER TABLE "callouts" ADD CONSTRAINT "callouts_challenger_profile_id_profiles_id_fk" FOREIGN KEY ("challenger_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callouts" ADD CONSTRAINT "callouts_opponent_profile_id_profiles_id_fk" FOREIGN KEY ("opponent_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callouts" ADD CONSTRAINT "callouts_pairing_id_nemesis_pairings_id_fk" FOREIGN KEY ("pairing_id") REFERENCES "public"."nemesis_pairings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_follows" ADD CONSTRAINT "topic_follows_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "callouts_token_hash_uq" ON "callouts" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "callouts_challenger_idx" ON "callouts" USING btree ("challenger_profile_id","created_at");--> statement-breakpoint
CREATE INDEX "callouts_opponent_idx" ON "callouts" USING btree ("opponent_profile_id");