import { db } from "@/db/client";
import { events } from "@/db/schema";

/** §7.17 — fire-and-forget, never blocks the request. */
export async function track(
  name: string,
  principalId: string | null,
  props: Record<string, unknown> = {}
): Promise<void> {
  try {
    await db.insert(events).values({ name, principalId, props });
  } catch (err) {
    console.error("track() failed", name, err);
  }
}
