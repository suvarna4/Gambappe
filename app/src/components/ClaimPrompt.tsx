"use client";

import { useEffect, useState } from "react";
import { fetchMe, type MeUser } from "@/lib/api";

/** §7.1.3: shown at CLAIM_PROMPT_STREAK / CLAIM_PROMPT_PICKS; dismissible; never blocks the loop. */
export function ClaimPrompt() {
  const [user, setUser] = useState<MeUser | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetchMe().then(setUser);
  }, []);

  if (!user || user.kind !== "ghost" || dismissed) return null;
  if (!user.prompts.claimStreak && !user.prompts.claimPicks) return null;

  const message = user.prompts.claimStreak
    ? `Your ghost has a ${user.stats.participationStreak}-day streak. Claim it before this device loses it.`
    : "Your fingerprint is ready. Claim your record to get assigned your nemesis.";

  return (
    <div className="ticket p-4 flex items-center justify-between gap-3">
      <p className="text-sm">{message}</p>
      <div className="flex gap-2 shrink-0">
        <a href="/api/claim/start" className="text-sm font-semibold underline">
          Claim
        </a>
        <button onClick={() => setDismissed(true)} className="text-sm text-[var(--ink-dim)]">
          ✕
        </button>
      </div>
    </div>
  );
}
