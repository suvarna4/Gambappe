CREATE TYPE "public"."duo_match_status" AS ENUM('scheduled', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."duo_status" AS ENUM('active', 'disbanded');--> statement-breakpoint
CREATE TYPE "public"."market_category" AS ENUM('sports', 'politics', 'economics', 'culture', 'science', 'other');--> statement-breakpoint
CREATE TYPE "public"."market_side" AS ENUM('yes', 'no');--> statement-breakpoint
CREATE TYPE "public"."market_status" AS ENUM('open', 'closed', 'resolved', 'voided');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email', 'push');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pairing_status" AS ENUM('scheduled', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pick_result" AS ENUM('pending', 'win', 'loss', 'void');--> statement-breakpoint
CREATE TYPE "public"."pick_source" AS ENUM('web', 'share_card', 'spectator_page');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('visible', 'removed_by_mod', 'removed_by_author');--> statement-breakpoint
CREATE TYPE "public"."profile_kind" AS ENUM('ghost', 'claimed');--> statement-breakpoint
CREATE TYPE "public"."profile_status" AS ENUM('active', 'paused_matchmaking', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."question_kind" AS ENUM('daily', 'nemesis_bonus', 'duo_bonus');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('draft', 'scheduled', 'open', 'locked', 'revealed', 'voided');--> statement-breakpoint
CREATE TYPE "public"."queue_status" AS ENUM('waiting', 'matched', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."rematch_status" AS ENUM('open', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."report_context" AS ENUM('post', 'pairing', 'duo', 'profile');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('abuse', 'spam', 'cheating', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'actioned', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."season_kind" AS ENUM('nemesis', 'duo', 'house');--> statement-breakpoint
CREATE TYPE "public"."thread_context" AS ENUM('question', 'pairing', 'duo_match');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."venue" AS ENUM('kalshi', 'polymarket');--> statement-breakpoint
CREATE TYPE "public"."wallet_link_status" AS ENUM('active', 'unlinked');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "profile_kind" NOT NULL,
	"status" "profile_status" DEFAULT 'active' NOT NULL,
	"handle" text NOT NULL,
	"slug" text NOT NULL,
	"matchmaking_priority" boolean DEFAULT false NOT NULL,
	"handle_is_generated" boolean DEFAULT true NOT NULL,
	"user_id" uuid,
	"ghost_secret_hash" text,
	"merged_into_profile_id" uuid,
	"claimed_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone NOT NULL,
	"timezone" text,
	"age_attested_at" timestamp with time zone,
	"bot_score" real DEFAULT 0 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"best_streak" integer DEFAULT 0 NOT NULL,
	"last_counted_date" date,
	"freeze_bank" smallint DEFAULT 0 NOT NULL,
	"current_win_streak" integer DEFAULT 0 NOT NULL,
	"best_win_streak" integer DEFAULT 0 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "streak_freeze_uses" (
	"profile_id" uuid NOT NULL,
	"covered_date" date NOT NULL,
	"used_at" timestamp with time zone NOT NULL,
	CONSTRAINT "streak_freeze_uses_profile_id_covered_date_pk" PRIMARY KEY("profile_id","covered_date")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"email_verified" timestamp with time zone,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"age_attested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "market_price_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"yes_price" numeric(6, 5) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"venue" "venue" NOT NULL,
	"venue_market_id" text NOT NULL,
	"title" text NOT NULL,
	"category" "market_category" NOT NULL,
	"close_time" timestamp with time zone NOT NULL,
	"expected_resolve_time" timestamp with time zone,
	"status" "market_status" NOT NULL,
	"outcome" "market_side",
	"yes_price" numeric(6, 5),
	"yes_price_updated_at" timestamp with time zone,
	"liquidity_usd" numeric,
	"venue_url" text NOT NULL,
	"nemesis_eligible" boolean DEFAULT false NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "picks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"question_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"side" "market_side" NOT NULL,
	"yes_price_at_entry" numeric(6, 5) NOT NULL,
	"price_stamped_at" timestamp with time zone NOT NULL,
	"picked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "pick_source" DEFAULT 'web' NOT NULL,
	"confidence" smallint,
	"result" "pick_result" DEFAULT 'pending' NOT NULL,
	"edge" numeric(7, 5),
	"graded_at" timestamp with time zone,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "picks_confidence_range" CHECK ("picks"."confidence" IS NULL OR ("picks"."confidence" BETWEEN 50 AND 100))
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "question_kind" NOT NULL,
	"market_id" uuid NOT NULL,
	"question_date" date,
	"slug" text,
	"headline" text NOT NULL,
	"blurb" text,
	"yes_label" text NOT NULL,
	"no_label" text NOT NULL,
	"open_at" timestamp with time zone NOT NULL,
	"lock_at" timestamp with time zone NOT NULL,
	"reveal_at" timestamp with time zone NOT NULL,
	"status" "question_status" DEFAULT 'draft' NOT NULL,
	"yes_count" integer DEFAULT 0 NOT NULL,
	"no_count" integer DEFAULT 0 NOT NULL,
	"crowd_yes_at_lock" integer,
	"crowd_no_at_lock" integer,
	"yes_price_at_lock" numeric(6, 5),
	"outcome" "market_side",
	"settled_at" timestamp with time zone,
	"revealed_at" timestamp with time zone,
	"void_reason" text,
	"is_volatile" boolean DEFAULT false NOT NULL,
	"event_start_at" timestamp with time zone,
	"paired_market_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fingerprints" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"resolved_pick_count" integer DEFAULT 0 NOT NULL,
	"brier" real,
	"accuracy" real,
	"edge_mean" real,
	"chalk" real,
	"contrarian" real,
	"timing" real,
	"category_shares" jsonb,
	"category_accuracy" jsonb,
	"calibration" jsonb,
	"placement_prior" jsonb,
	"computed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"glicko_rating" real DEFAULT 1500 NOT NULL,
	"glicko_rd" real DEFAULT 350 NOT NULL,
	"glicko_vol" real DEFAULT 0.06 NOT NULL,
	"games_count" integer DEFAULT 0 NOT NULL,
	"accuracy_percentile" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "season_kind" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duo_match_questions" (
	"match_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	CONSTRAINT "duo_match_questions_match_id_question_id_pk" PRIMARY KEY("match_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "duo_matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"duo_a_id" uuid NOT NULL,
	"duo_b_id" uuid NOT NULL,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"status" "duo_match_status" NOT NULL,
	"score_a" smallint DEFAULT 0 NOT NULL,
	"score_b" smallint DEFAULT 0 NOT NULL,
	"winner_duo_id" uuid,
	"rating_applied_at" timestamp with time zone,
	"rating_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duo_queue_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"status" "queue_status" DEFAULT 'waiting' NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"matched_duo_id" uuid
);
--> statement-breakpoint
CREATE TABLE "duos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_a_id" uuid NOT NULL,
	"profile_b_id" uuid NOT NULL,
	"status" "duo_status" NOT NULL,
	"tier" smallint DEFAULT 1 NOT NULL,
	"glicko_rating" real DEFAULT 1500 NOT NULL,
	"glicko_rd" real DEFAULT 350 NOT NULL,
	"glicko_vol" real DEFAULT 0.06 NOT NULL,
	"matches_played" integer DEFAULT 0 NOT NULL,
	"joint_hit_rate" real,
	"synergy" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nemesis_pairings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"season_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"profile_a_id" uuid NOT NULL,
	"profile_b_id" uuid NOT NULL,
	"status" "pairing_status" NOT NULL,
	"score_a" smallint DEFAULT 0 NOT NULL,
	"score_b" smallint DEFAULT 0 NOT NULL,
	"edge_a" numeric(8, 5) DEFAULT 0 NOT NULL,
	"edge_b" numeric(8, 5) DEFAULT 0 NOT NULL,
	"winner_profile_id" uuid,
	"verdict" jsonb,
	"is_rematch" boolean DEFAULT false NOT NULL,
	"rating_applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pairing_questions" (
	"pairing_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	CONSTRAINT "pairing_questions_pairing_id_question_id_pk" PRIMARY KEY("pairing_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "placement_answers" (
	"profile_id" uuid NOT NULL,
	"placement_item_id" uuid NOT NULL,
	"side" "market_side" NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "placement_answers_profile_id_placement_item_id_pk" PRIMARY KEY("profile_id","placement_item_id")
);
--> statement-breakpoint
CREATE TABLE "placement_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" "market_category" NOT NULL,
	"yes_label" text NOT NULL,
	"no_label" text NOT NULL,
	"historical_yes_price" numeric(6, 5) NOT NULL,
	"historical_crowd_yes_pct" real NOT NULL,
	"outcome" "market_side" NOT NULL,
	"resolved_on" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rematch_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requester_profile_id" uuid NOT NULL,
	"target_profile_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"status" "rematch_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- analytics_events is RANGE-partitioned by month on ts from day one (design doc §5.6).
-- Hand-adjusted from the drizzle-kit output (drizzle-kit cannot express declarative
-- partitioning); the schema snapshot matches the column/PK/index shape, so drift checks stay
-- clean. Future partitions are created by maintenance:prune (apps/worker) and by the helper
-- below; expired partitions (>13 months) are dropped by the same job.
CREATE TABLE "analytics_events" (
	"id" bigserial NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"event" text NOT NULL,
	"profile_id" uuid,
	"is_ghost" boolean,
	"anon_id" text,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_hash" text,
	"ua_hash" text,
	CONSTRAINT "analytics_events_id_ts_pk" PRIMARY KEY("id","ts")
) PARTITION BY RANGE ("ts");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ensure_analytics_events_partition(month_start date)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  part_name text := 'analytics_events_' || to_char(month_start, 'YYYY_MM');
  range_start timestamptz := month_start::timestamptz;
  range_end timestamptz := (month_start + interval '1 month')::timestamptz;
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF analytics_events FOR VALUES FROM (%L) TO (%L)',
    part_name, range_start, range_end
  );
END;
$fn$;
--> statement-breakpoint
-- Bootstrap partitions: current month and the next (worker maintains the horizon after that).
SELECT ensure_analytics_events_partition(date_trunc('month', now())::date);
--> statement-breakpoint
SELECT ensure_analytics_events_partition((date_trunc('month', now()) + interval '1 month')::date);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"blocker_profile_id" uuid NOT NULL,
	"blocked_profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_profile_id_blocked_profile_id_pk" PRIMARY KEY("blocker_profile_id","blocked_profile_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"context_kind" "thread_context" NOT NULL,
	"context_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"body" text NOT NULL,
	"status" "post_status" DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"context_kind" "thread_context" NOT NULL,
	"context_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reporter_profile_id" uuid NOT NULL,
	"reported_profile_id" uuid,
	"context_kind" "report_context" NOT NULL,
	"context_id" uuid NOT NULL,
	"reason" "report_reason" NOT NULL,
	"note" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"address" text,
	"address_hash" text NOT NULL,
	"proxy_address" text,
	"verified_at" timestamp with time zone NOT NULL,
	"status" "wallet_link_status" NOT NULL,
	"enrichment" jsonb,
	"unlinked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_heartbeats" (
	"job_name" text PRIMARY KEY NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_rollups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	"dims" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streak_freeze_uses" ADD CONSTRAINT "streak_freeze_uses_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_price_snapshots" ADD CONSTRAINT "market_price_snapshots_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_paired_market_id_markets_id_fk" FOREIGN KEY ("paired_market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fingerprints" ADD CONSTRAINT "fingerprints_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duo_match_questions" ADD CONSTRAINT "duo_match_questions_match_id_duo_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."duo_matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duo_match_questions" ADD CONSTRAINT "duo_match_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duo_matches" ADD CONSTRAINT "duo_matches_duo_a_id_duos_id_fk" FOREIGN KEY ("duo_a_id") REFERENCES "public"."duos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duo_matches" ADD CONSTRAINT "duo_matches_duo_b_id_duos_id_fk" FOREIGN KEY ("duo_b_id") REFERENCES "public"."duos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duo_matches" ADD CONSTRAINT "duo_matches_winner_duo_id_duos_id_fk" FOREIGN KEY ("winner_duo_id") REFERENCES "public"."duos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duo_queue_entries" ADD CONSTRAINT "duo_queue_entries_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duo_queue_entries" ADD CONSTRAINT "duo_queue_entries_matched_duo_id_duos_id_fk" FOREIGN KEY ("matched_duo_id") REFERENCES "public"."duos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duos" ADD CONSTRAINT "duos_profile_a_id_profiles_id_fk" FOREIGN KEY ("profile_a_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duos" ADD CONSTRAINT "duos_profile_b_id_profiles_id_fk" FOREIGN KEY ("profile_b_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nemesis_pairings" ADD CONSTRAINT "nemesis_pairings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nemesis_pairings" ADD CONSTRAINT "nemesis_pairings_profile_a_id_profiles_id_fk" FOREIGN KEY ("profile_a_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nemesis_pairings" ADD CONSTRAINT "nemesis_pairings_profile_b_id_profiles_id_fk" FOREIGN KEY ("profile_b_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nemesis_pairings" ADD CONSTRAINT "nemesis_pairings_winner_profile_id_profiles_id_fk" FOREIGN KEY ("winner_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_questions" ADD CONSTRAINT "pairing_questions_pairing_id_nemesis_pairings_id_fk" FOREIGN KEY ("pairing_id") REFERENCES "public"."nemesis_pairings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_questions" ADD CONSTRAINT "pairing_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_answers" ADD CONSTRAINT "placement_answers_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_answers" ADD CONSTRAINT "placement_answers_placement_item_id_placement_items_id_fk" FOREIGN KEY ("placement_item_id") REFERENCES "public"."placement_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rematch_requests" ADD CONSTRAINT "rematch_requests_requester_profile_id_profiles_id_fk" FOREIGN KEY ("requester_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rematch_requests" ADD CONSTRAINT "rematch_requests_target_profile_id_profiles_id_fk" FOREIGN KEY ("target_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rematch_requests" ADD CONSTRAINT "rematch_requests_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_profile_id_profiles_id_fk" FOREIGN KEY ("blocker_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_profile_id_profiles_id_fk" FOREIGN KEY ("blocked_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_profile_id_profiles_id_fk" FOREIGN KEY ("reporter_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_profile_id_profiles_id_fk" FOREIGN KEY ("reported_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_links" ADD CONSTRAINT "wallet_links_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_handle_lower_uq" ON "profiles" USING btree (lower("handle"));--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_slug_uq" ON "profiles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "profiles_kind_status_idx" ON "profiles" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "profiles_bot_score_idx" ON "profiles" USING btree ("bot_score") WHERE "profiles"."bot_score" > 0.5;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "market_price_snapshots_market_ts_idx" ON "market_price_snapshots" USING btree ("market_id","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "markets_venue_market_uq" ON "markets" USING btree ("venue","venue_market_id");--> statement-breakpoint
CREATE INDEX "markets_status_close_time_idx" ON "markets" USING btree ("status","close_time");--> statement-breakpoint
CREATE UNIQUE INDEX "picks_question_profile_uq" ON "picks" USING btree ("question_id","profile_id");--> statement-breakpoint
CREATE INDEX "picks_profile_picked_at_idx" ON "picks" USING btree ("profile_id","picked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "picks_question_result_idx" ON "picks" USING btree ("question_id","result");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_slug_uq" ON "questions" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_daily_date_uq" ON "questions" USING btree ("question_date") WHERE "questions"."kind" = 'daily';--> statement-breakpoint
CREATE INDEX "questions_kind_status_idx" ON "questions" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "questions_status_lock_at_idx" ON "questions" USING btree ("status","lock_at");--> statement-breakpoint
CREATE INDEX "questions_status_reveal_at_idx" ON "questions" USING btree ("status","reveal_at");--> statement-breakpoint
CREATE INDEX "duo_matches_status_window_idx" ON "duo_matches" USING btree ("status","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "duo_queue_waiting_uq" ON "duo_queue_entries" USING btree ("profile_id") WHERE "duo_queue_entries"."status" = 'waiting';--> statement-breakpoint
CREATE UNIQUE INDEX "duos_profile_a_active_uq" ON "duos" USING btree ("profile_a_id") WHERE "duos"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "duos_profile_b_active_uq" ON "duos" USING btree ("profile_b_id") WHERE "duos"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "nemesis_pairings_week_a_uq" ON "nemesis_pairings" USING btree ("season_id","week_start","profile_a_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nemesis_pairings_week_b_uq" ON "nemesis_pairings" USING btree ("season_id","week_start","profile_b_id");--> statement-breakpoint
CREATE INDEX "nemesis_pairings_profile_a_idx" ON "nemesis_pairings" USING btree ("profile_a_id");--> statement-breakpoint
CREATE INDEX "nemesis_pairings_profile_b_idx" ON "nemesis_pairings" USING btree ("profile_b_id");--> statement-breakpoint
CREATE INDEX "nemesis_pairings_status_week_idx" ON "nemesis_pairings" USING btree ("status","week_start");--> statement-breakpoint
CREATE INDEX "rematch_requests_target_idx" ON "rematch_requests" USING btree ("target_profile_id","status");--> statement-breakpoint
CREATE INDEX "analytics_events_event_ts_idx" ON "analytics_events" USING btree ("event","ts");--> statement-breakpoint
CREATE INDEX "analytics_events_profile_ts_idx" ON "analytics_events" USING btree ("profile_id","ts");--> statement-breakpoint
CREATE INDEX "audit_log_ts_idx" ON "audit_log" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "notifications_status_scheduled_idx" ON "notifications" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "posts_context_created_idx" ON "posts" USING btree ("context_kind","context_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_context_profile_emoji_uq" ON "reactions" USING btree ("context_kind","context_id","profile_id","emoji");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_links_profile_active_uq" ON "wallet_links" USING btree ("profile_id") WHERE "wallet_links"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_links_address_hash_active_uq" ON "wallet_links" USING btree ("address_hash") WHERE "wallet_links"."status" = 'active';--> statement-breakpoint
CREATE INDEX "metric_rollups_date_metric_idx" ON "metric_rollups" USING btree ("date","metric");