"use client";

import { useEffect, useState } from "react";

export default function NemesisPage() {
  const [pairing, setPairing] = useState<{ id: string; status: string } | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/nemesis/current")
      .then((r) => r.json())
      .then((json) => setPairing(json.pairing));
  }, []);

  if (pairing === undefined) return <div className="text-center text-[var(--ink-dim)] py-12">Loading...</div>;

  if (!pairing) {
    return (
      <div className="ticket p-6 text-center text-[var(--ink-dim)]">
        No nemesis assigned yet. Keep picking — you&apos;ll get matched once you&apos;re eligible.
      </div>
    );
  }

  if (typeof window !== "undefined") {
    window.location.href = `/vs/${pairing.id}`;
  }
  return <div className="text-center text-[var(--ink-dim)] py-12">Redirecting to your matchup...</div>;
}
