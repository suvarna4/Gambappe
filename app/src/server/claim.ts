import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { createSession } from "./principal";

export type ClaimOutcome =
  | { kind: "promoted_to_pending"; sessionToken: string }
  | { kind: "existing_account_dead_end" };

/**
 * §7.1.3 step 2. MVP simple path only: a brand-new email promotes the
 * ghost row in place to 'pending' (D-1 — same row, never migrated). An
 * email that already has a claimed account is a dead end for now
 * (§16.3: "returning-user merge is post-hackathon").
 */
export async function completeOAuthIdentity(
  ghostUserId: string,
  email: string
): Promise<ClaimOutcome> {
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return { kind: "existing_account_dead_end" };
  }

  await db
    .update(users)
    .set({ kind: "pending", email })
    .where(eq(users.id, ghostUserId));

  const sessionToken = await createSession(ghostUserId);
  return { kind: "promoted_to_pending", sessionToken };
}
