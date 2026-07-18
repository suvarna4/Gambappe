"use client";

import { useState } from "react";
import type { PublicQuestion, MyPick } from "@/lib/api";

/** §7.8 share flow: native Web Share API with the card image + URL; fallback copy-link. */
export function ShareButton({
  question,
  pick,
  result,
}: {
  question: PublicQuestion;
  pick: MyPick;
  result?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const cardUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/cards/daily/${pick.id}` : "";
  const pageUrl = typeof window !== "undefined" ? `${window.location.origin}/q/${question.id}` : "";

  async function share() {
    await track("card_shared", { cardType: "daily", result: result ?? pick.result });
    if (navigator.share) {
      try {
        await navigator.share({ title: question.headline, url: pageUrl });
        return;
      } catch {
        // user cancelled or unsupported — fall through to copy
      }
    }
    await navigator.clipboard?.writeText(pageUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col items-center gap-2 mt-2">
      {cardUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cardUrl} alt="Your ticket" className="rounded-lg border border-[var(--border)] w-full" />
      )}
      <button
        onClick={share}
        className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--surface-2)]"
      >
        {copied ? "Link copied!" : "Share"}
      </button>
    </div>
  );
}

async function track(name: string, props: Record<string, unknown>) {
  try {
    await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, props }),
    });
  } catch {
    // fire-and-forget
  }
}
