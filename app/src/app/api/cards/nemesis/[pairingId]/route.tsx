import { ImageResponse } from "next/og";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { nemesisPairings, users } from "@/db/schema";
import {
  narrateAssigned,
  narrateVerdictWinner,
  narrateVerdictLoser,
  type NemesisNarrationContext,
} from "@/engine/narration/narration";
import { CONSTANTS } from "@/shared/constants";

export const runtime = "nodejs";

/**
 * §7.8 nemesis cards: assignment + verdict (winner/loser). Loser gets
 * the SAME layout weight as the winner (P3) — no smaller text, no
 * washed-out color, just a grey stamp instead of cyan.
 */
export async function GET(req: Request, { params }: { params: Promise<{ pairingId: string }> }) {
  const { pairingId } = await params;
  const url = new URL(req.url);
  const perspective = url.searchParams.get("as"); // 'a' | 'b' — which side this card is FOR (loser gets the narrative lead when they view their own card)

  const [pairing] = await db.select().from(nemesisPairings).where(eq(nemesisPairings.id, pairingId)).limit(1);
  if (!pairing) return new Response("Not found", { status: 404 });

  const [userA] = await db.select().from(users).where(eq(users.id, pairing.userA)).limit(1);
  const [userB] = await db.select().from(users).where(eq(users.id, pairing.userB)).limit(1);

  const ctx: NemesisNarrationContext = {
    pairingId: pairing.id,
    handleA: userA?.handle ?? "?",
    handleB: userB?.handle ?? "?",
    scoreA: pairing.scoreA,
    scoreB: pairing.scoreB,
    questionsRemaining: Math.max(0, CONSTANTS.NEMESIS_MATCH_QUESTIONS),
  };
  const winnerHandle = pairing.winner === "a" ? ctx.handleA : pairing.winner === "b" ? ctx.handleB : undefined;
  const loserHandle = pairing.winner === "a" ? ctx.handleB : pairing.winner === "b" ? ctx.handleA : undefined;

  const isLoserPerspective = perspective === "a" ? pairing.winner === "b" : perspective === "b" ? pairing.winner === "a" : false;

  // P3: the loser's OWN card leads with the loser-framed narration, not
  // the winner's framing — losing publicly, with style, is the brand.
  const narration =
    pairing.status !== "completed"
      ? narrateAssigned(ctx)
      : isLoserPerspective && loserHandle
        ? narrateVerdictLoser(ctx, loserHandle)
        : winnerHandle
          ? narrateVerdictWinner(ctx, winnerHandle)
          : narrateAssigned(ctx);
  const accentColor = isLoserPerspective ? "#9aa0ac" : "#4cc9f0";

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
        <div style={{ fontSize: 22, color: "#9aa0ac", letterSpacing: 2, display: "flex" }}>RECEIPTS · NEMESIS</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 48, fontWeight: 800 }}>
          <div style={{ display: "flex", color: pairing.winner === "b" ? "#9aa0ac" : "#f2f3f5" }}>{ctx.handleA}</div>
          <div style={{ display: "flex", color: accentColor }}>
            {pairing.scoreA} – {pairing.scoreB}
          </div>
          <div style={{ display: "flex", color: pairing.winner === "a" ? "#9aa0ac" : "#f2f3f5" }}>{ctx.handleB}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "2px dashed #2a2d38", paddingTop: 20 }}>
          <div style={{ fontSize: 32, fontWeight: 700, display: "flex" }}>{narration.headline}</div>
          <div style={{ fontSize: 22, color: "#9aa0ac", display: "flex" }}>{narration.body}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
