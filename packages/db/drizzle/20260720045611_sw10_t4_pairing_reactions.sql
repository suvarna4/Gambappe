CREATE TABLE "pairing_reactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pairing_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"reaction_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pairing_reactions" ADD CONSTRAINT "pairing_reactions_pairing_id_nemesis_pairings_id_fk" FOREIGN KEY ("pairing_id") REFERENCES "public"."nemesis_pairings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_reactions" ADD CONSTRAINT "pairing_reactions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pairing_reactions_pairing_profile_date_uq" ON "pairing_reactions" USING btree ("pairing_id","profile_id","reaction_date");--> statement-breakpoint
CREATE INDEX "pairing_reactions_pairing_date_idx" ON "pairing_reactions" USING btree ("pairing_id","reaction_date");