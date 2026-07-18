"use client";

import { useEffect, useState } from "react";
import { use } from "react";

interface PairingData {
  id: string;
  userA: { handle: string } | null;
  userB: { handle: string } | null;
  status: string;
  scoreA: number;
  scoreB: number;
  winner: "a" | "b" | "tie" | null;
  questions: { headline?: string; pickA: { side: string; entryPrice: number; result: string } | null; pickB: { side: string; entryPrice: number; result: string } | null }[];
  narration: { headline: string; body: string };
}

export default function MatchupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<PairingData | null>(null);

  useEffect(() => {
    fetch(`/api/vs/${id}`)
      .then((r) => r.json())
      .then((json) => setData(json.pairing));
  }, [id]);

  if (!data) return <div className="text-center text-[var(--ink-dim)] py-12">Loading...</div>;

  const isLoserA = data.winner === "b";
  const isLoserB = data.winner === "a";

  return (
    <main className="flex-1 flex flex-col gap-6 pt-4">
      <div className="ticket p-6 flex flex-col gap-4">
        <div className="text-xs uppercase tracking-widest text-[var(--ink-dim)] text-center">nemesis matchup</div>
        <div className="flex justify-between items-center numeral text-lg font-bold">
          <span className={isLoserA ? "text-[var(--ink-dim)]" : ""}>{data.userA?.handle}</span>
          <span>
            {data.scoreA} – {data.scoreB}
          </span>
          <span className={isLoserB ? "text-[var(--ink-dim)]" : ""}>{data.userB?.handle}</span>
        </div>
        <div className="tear-line pt-4 text-center">
          <div className="font-semibold">{data.narration.headline}</div>
          <div className="text-sm text-[var(--ink-dim)] mt-1">{data.narration.body}</div>
        </div>
      </div>

      {data.questions.length > 0 && (
        <div className="ticket p-4 flex flex-col gap-2">
          <h2 className="text-sm font-semibold">This week&apos;s markets</h2>
          {data.questions.map((q, i) => (
            <div key={i} className="tear-line pt-2 text-sm flex flex-col gap-1">
              <div className="truncate">{q.headline}</div>
              <div className="flex justify-between numeral text-xs">
                <span>{q.pickA ? `${q.pickA.side} ¢${Math.round(q.pickA.entryPrice * 100)} (${q.pickA.result})` : "—"}</span>
                <span>{q.pickB ? `${q.pickB.side} ¢${Math.round(q.pickB.entryPrice * 100)} (${q.pickB.result})` : "—"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
