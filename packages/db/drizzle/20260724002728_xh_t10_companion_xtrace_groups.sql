CREATE TABLE "companion_xtrace_groups" (
	"pairing_id" uuid PRIMARY KEY NOT NULL,
	"xtrace_group_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companion_xtrace_groups" ADD CONSTRAINT "companion_xtrace_groups_pairing_id_nemesis_pairings_id_fk" FOREIGN KEY ("pairing_id") REFERENCES "public"."nemesis_pairings"("id") ON DELETE no action ON UPDATE no action;