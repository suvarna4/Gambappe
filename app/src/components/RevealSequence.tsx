"use client";

import { useEffect, useState } from "react";
import { fetchReveal, type PublicQuestion, type MyPick, type RevealPayload } from "@/lib/api";
import { ShareButton } from "./ShareButton";

/**
 * §5.6/§10.1: stamp slam -> crowd bars -> percentile count-up -> streak
 * update. ~2.5s total, skippable, honors prefers-reduced-motion (jump
 * straight to the final state).
 */
export function RevealSequence({ question, myPick }: { question: PublicQuestion; myPick: MyPick }) {
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  const [stage, setStage] = useState(0);
  const reduced =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    fetchReveal(question.id).then(setReveal);
  }, [question.id]);

  useEffect(() => {
    if (!reveal) return;
    if (reduced) {
      setStage(3);
      return;
    }
    const timers = [
      setTimeout(() => setStage(1), 300),
      setTimeout(() => setStage(2), 1100),
      setTimeout(() => setStage(3), 1900),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reveal, reduced]);

  if (!reveal) {
    return <div className="text-center py-8 text-[var(--ink-dim)]">Loading your result...</div>;
  }

  const won = reveal.result === "win";
  const color = won ? "var(--win)" : "var(--loss)";

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <button
        className="self-end text-xs text-[var(--ink-dim)] underline"
        onClick={() => setStage(3)}
      >
        Skip
      </button>

      {stage >= 0 && (
        <div
          className={`stamp numeral text-4xl font-bold border-4 rounded-lg px-6 py-3 transition-opacity duration-300 ${
            stage >= 1 ? "opacity-100" : "opacity-0"
          }`}
          style={{ borderColor: color, color }}
        >
          {won ? "WIN ✓" : reveal.result === "loss" ? "LOSS ✗" : "VOID"}
        </div>
      )}

      {stage >= 2 && reveal.crowdYesAtLock != null && (
        <div className="w-full flex flex-col gap-1 animate-[fadeIn_0.3s]">
          <div className="flex h-3 rounded-full overflow-hidden border border-[var(--border)]">
            <div
              style={{
                width: `${(reveal.crowdYesAtLock / Math.max(1, reveal.crowdYesAtLock + (reveal.crowdNoAtLock ?? 0))) * 100}%`,
                background: "var(--side-yes)",
              }}
            />
            <div
              style={{
                width: `${((reveal.crowdNoAtLock ?? 0) / Math.max(1, reveal.crowdYesAtLock + (reveal.crowdNoAtLock ?? 0))) * 100}%`,
                background: "var(--side-no)",
              }}
            />
          </div>
          {reveal.percentile != null && (
            <p className="text-sm text-center mt-1">
              You beat <span className="numeral font-semibold">{Math.round(reveal.percentile * 100)}%</span> of
              today&apos;s pickers.
            </p>
          )}
        </div>
      )}

      {stage >= 3 && (
        <div className="flex flex-col items-center gap-2 tear-line pt-4 w-full">
          <div className="numeral text-sm text-[var(--ink-dim)]">
            Streak: <span className="text-[var(--ink)] font-semibold">{reveal.participationStreak}</span>
          </div>
          <ShareButton
            question={question}
            pick={{ ...myPick, result: reveal.result }}
            result={reveal.result}
          />
        </div>
      )}
    </div>
  );
}
