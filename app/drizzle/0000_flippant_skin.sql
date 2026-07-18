CREATE TYPE "public"."user_kind" AS ENUM('ghost', 'pending', 'claimed');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'paused_matchmaking', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."category" AS ENUM('sports', 'politics', 'econ', 'culture', 'science', 'other');--> statement-breakpoint
CREATE TYPE "public"."market_status" AS ENUM('active', 'settled', 'voided');--> statement-breakpoint
CREATE TYPE "public"."outcome" AS ENUM('yes', 'no', 'void');--> statement-breakpoint
CREATE TYPE "public"."venue" AS ENUM('kalshi', 'polymarket', 'fake');--> statement-breakpoint
CREATE TYPE "public"."question_kind" AS ENUM('daily', 'nemesis_bonus', 'duo', 'placement');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('draft', 'open', 'locked', 'graded', 'revealed', 'voided');--> statement-breakpoint
CREATE TYPE "public"."pick_result" AS ENUM('pending', 'win', 'loss', 'void');--> statement-breakpoint
CREATE TYPE "public"."pick_side" AS ENUM('yes', 'no');--> statement-breakpoint
CREATE TYPE "public"."nemesis_status" AS ENUM('active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."nemesis_winner" AS ENUM('a', 'b', 'tie');--> statement-breakpoint
CREATE TABLE "ghost_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ip_hash" text NOT NULL,
	"ua_hash" text NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "user_kind" DEFAULT 'ghost' NOT NULL,
	"handle" text NOT NULL,
	"handle_customized" boolean DEFAULT false NOT NULL,
	"email" text,
	"tz" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"age_attested_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"bot_suspect" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_prices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_id" uuid NOT NULL,
	"price_yes" numeric(6, 5) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue" "venue" NOT NULL,
	"venue_market_id" text NOT NULL,
	"title" text NOT NULL,
	"category" "category" NOT NULL,
	"yes_label" text NOT NULL,
	"no_label" text NOT NULL,
	"url" text NOT NULL,
	"close_time" timestamp with time zone,
	"status" "market_status" DEFAULT 'active' NOT NULL,
	"outcome" "outcome",
	"settled_at" timestamp with time zone,
	"last_price_yes" numeric(6, 5),
	"price_updated_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_participants" (
	"question_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "question_participants_question_id_user_id_pk" PRIMARY KEY("question_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"kind" "question_kind" NOT NULL,
	"question_date" date,
	"opens_at" timestamp with time zone NOT NULL,
	"locks_at" timestamp with time zone NOT NULL,
	"status" "question_status" DEFAULT 'draft' NOT NULL,
	"locked_at" timestamp with time zone,
	"graded_at" timestamp with time zone,
	"reveal_at" timestamp with time zone,
	"revealed_at" timestamp with time zone,
	"crowd_yes" integer DEFAULT 0 NOT NULL,
	"crowd_no" integer DEFAULT 0 NOT NULL,
	"crowd_yes_at_lock" integer,
	"crowd_no_at_lock" integer,
	"price_yes_at_lock" numeric(6, 5),
	"price_yes_at_settle" numeric(6, 5),
	"headline" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"side" "pick_side" NOT NULL,
	"entry_price" numeric(6, 5) NOT NULL,
	"entry_price_at" timestamp with time zone NOT NULL,
	"picked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" "pick_result" DEFAULT 'pending' NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_stats" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"participation_streak" integer DEFAULT 0 NOT NULL,
	"best_participation_streak" integer DEFAULT 0 NOT NULL,
	"win_streak" integer DEFAULT 0 NOT NULL,
	"best_win_streak" integer DEFAULT 0 NOT NULL,
	"last_daily_pick_date" date,
	"picks_total" integer DEFAULT 0 NOT NULL,
	"picks_resolved" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"edge_sum" numeric(12, 6) DEFAULT '0' NOT NULL,
	"category_stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nemesis_match_questions" (
	"pairing_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	CONSTRAINT "nemesis_match_questions_pairing_id_question_id_pk" PRIMARY KEY("pairing_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "nemesis_members" (
	"week_start" date NOT NULL,
	"user_id" uuid NOT NULL,
	"pairing_id" uuid NOT NULL,
	CONSTRAINT "nemesis_members_week_start_user_id_pk" PRIMARY KEY("week_start","user_id")
);
--> statement-breakpoint
CREATE TABLE "nemesis_pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_start" date NOT NULL,
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"status" "nemesis_status" DEFAULT 'active' NOT NULL,
	"score_a" integer DEFAULT 0 NOT NULL,
	"score_b" integer DEFAULT 0 NOT NULL,
	"edge_a" numeric(10, 6) DEFAULT '0' NOT NULL,
	"edge_b" numeric(10, 6) DEFAULT '0' NOT NULL,
	"winner" "nemesis_winner",
	"is_rematch" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"ghost_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"subject" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"principal_id" text,
	"anon_id" text,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "ghost_devices" ADD CONSTRAINT "ghost_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_prices" ADD CONSTRAINT "market_prices_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_participants" ADD CONSTRAINT "question_participants_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_participants" ADD CONSTRAINT "question_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nemesis_match_questions" ADD CONSTRAINT "nemesis_match_questions_pairing_id_nemesis_pairings_id_fk" FOREIGN KEY ("pairing_id") REFERENCES "public"."nemesis_pairings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nemesis_match_questions" ADD CONSTRAINT "nemesis_match_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nemesis_members" ADD CONSTRAINT "nemesis_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nemesis_members" ADD CONSTRAINT "nemesis_members_pairing_id_nemesis_pairings_id_fk" FOREIGN KEY ("pairing_id") REFERENCES "public"."nemesis_pairings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nemesis_pairings" ADD CONSTRAINT "nemesis_pairings_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nemesis_pairings" ADD CONSTRAINT "nemesis_pairings_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ghost_devices_ip_hash_idx" ON "ghost_devices" USING btree ("ip_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_unique" ON "users" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email") WHERE "users"."email" is not null;--> statement-breakpoint
CREATE INDEX "users_kind_idx" ON "users" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_bot_suspect_idx" ON "users" USING btree ("bot_suspect") WHERE "users"."bot_suspect" = true;--> statement-breakpoint
CREATE INDEX "market_prices_market_observed_idx" ON "market_prices" USING btree ("market_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_venue_market_unique" ON "markets" USING btree ("venue","venue_market_id");--> statement-breakpoint
CREATE INDEX "markets_status_idx" ON "markets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "markets_category_idx" ON "markets" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_daily_date_unique" ON "questions" USING btree ("question_date") WHERE "questions"."kind" = 'daily';--> statement-breakpoint
CREATE INDEX "questions_status_locks_idx" ON "questions" USING btree ("status","locks_at");--> statement-breakpoint
CREATE INDEX "questions_kind_idx" ON "questions" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "picks_question_user_unique" ON "picks" USING btree ("question_id","user_id");--> statement-breakpoint
CREATE INDEX "picks_user_picked_idx" ON "picks" USING btree ("user_id","picked_at");--> statement-breakpoint
CREATE INDEX "picks_question_idx" ON "picks" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "nemesis_pairings_week_users_idx" ON "nemesis_pairings" USING btree ("week_start","user_a","user_b");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_name_at_idx" ON "events" USING btree ("name","at");