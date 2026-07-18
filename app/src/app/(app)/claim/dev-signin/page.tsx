"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function DevSigninForm() {
  const params = useSearchParams();
  const state = params.get("state") ?? "";
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const res = await fetch("/api/claim/dev-signin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, email }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.error?.message ?? "Something went wrong");
      return;
    }
    window.location.href = json.redirect;
  }

  return (
    <div className="ticket p-6 flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Dev sign-in (no Google credentials configured)</h1>
      <p className="text-xs text-[var(--ink-dim)]">
        Set AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET to use real Google sign-in. This screen simulates it for local dev.
      </p>
      <input
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button onClick={submit} className="rounded-lg border border-[var(--border)] px-4 py-2 font-medium">
        Continue
      </button>
    </div>
  );
}

/** Dev-only stand-in for the Google consent screen. See api/claim/dev-signin/route.ts. */
export default function DevSigninPage() {
  return (
    <Suspense fallback={<div className="text-center text-[var(--ink-dim)] py-12">Loading...</div>}>
      <DevSigninForm />
    </Suspense>
  );
}
