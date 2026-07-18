import { ImageResponse } from "next/og";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { picks, questions, markets, users } from "@/db/schema";
import { CONSTANTS } from "@/shared/constants";

export const runtime = "nodejs";

/**
 * §7.8 daily result card. Status-gated exactly like the page (D-16):
 * 404 until the question is locked (side/entry become visible then);
 * result stamp only once revealed. Loser cards get equal visual weight
 * (P3) — same layout, a steady grey stamp instead of the cyan win glow.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ pickId: string }> }) {
  const { pickId } = await params;
  const [row] = await db
    .select({ pick: picks, question: questions, market: markets, user: users })
    .from(picks)
    .innerJoin(questions, eq(picks.questionId, questions.id))
    .innerJoin(markets, eq(questions.marketId, markets.id))
    .innerJoin(users, eq(picks.userId, users.id))
    .where(eq(picks.id, pickId))
    .limit(1);

  if (!row || !["locked", "graded", "revealed"].includes(row.question.status)) {
    return new Response("Not found", { status: 404 });
  }

  const { pick, question, market, user } = row;
  const revealed = question.status === "revealed";
  const won = revealed && pick.result === "win";
  const lost = revealed && pick.result === "loss";
  const entryPrice = Number(pick.entryPrice);
  const calledIt = won && entryPrice <= CONSTANTS.LONGSHOT_THRESHOLD;
  const sideColor = pick.side === "yes" ? "#4cc9f0" : "#f4a261";
  const stampColor = revealed ? (won ? "#4cc9f0" : "#9aa0ac") : sideColor;

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
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 22, color: "#9aa0ac", letterSpacing: 2 }}>RECEIPTS</div>
          <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.25 }}>{question.headline}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {calledIt && (
            <div style={{ fontSize: 24, color: "#4cc9f0", display: "flex" }}>CALLED IT</div>
          )}
          <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
            <div style={{ fontSize: 64, fontWeight: 800, color: sideColor, display: "flex" }}>
              {pick.side.toUpperCase()}
            </div>
            <div style={{ fontSize: 48, fontWeight: 700, display: "flex" }}>¢{Math.round(entryPrice * 100)}</div>
          </div>
          {revealed && (
            <div
              style={{
                display: "flex",
                fontSize: 40,
                fontWeight: 800,
                color: stampColor,
                border: `4px solid ${stampColor}`,
                borderRadius: 12,
                padding: "8px 20px",
                alignSelf: "flex-start",
                transform: "rotate(-3deg)",
              }}
            >
              {won ? "WIN" : lost ? "LOSS" : "VOID"}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 20,
            color: "#9aa0ac",
            borderTop: "2px dashed #2a2d38",
            paddingTop: 16,
          }}
        >
          <div style={{ display: "flex" }}>{user.handle}</div>
          <div style={{ display: "flex" }}>receipts.app/q/{question.id.slice(0, 8)}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
