import { ImageResponse } from "next/og";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, userStats } from "@/db/schema";

export const runtime = "nodejs";

/** §7.8 claim-your-ghost card — the conversion carrot artifact. */
export async function GET(_req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const [user] = await db.select().from(users).where(eq(users.handle, handle)).limit(1);
  if (!user) return new Response("Not found", { status: 404 });
  const [stats] = await db.select().from(userStats).where(eq(userStats.userId, user.id)).limit(1);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0d0e12",
          color: "#f2f3f5",
          padding: 56,
          fontFamily: "monospace",
        }}
      >
        <div style={{ fontSize: 22, color: "#9aa0ac", letterSpacing: 2, display: "flex" }}>RECEIPTS</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 40, fontWeight: 700, display: "flex" }}>{handle}&apos;s ghost has a</div>
          <div style={{ fontSize: 72, fontWeight: 800, color: "#4cc9f0", display: "flex" }}>
            {stats?.participationStreak ?? 0}-day streak
          </div>
        </div>
        <div style={{ fontSize: 26, color: "#9aa0ac", borderTop: "2px dashed #2a2d38", paddingTop: 20, display: "flex" }}>
          Claim it before this device loses it.
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
