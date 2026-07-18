"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchMe, type MeUser } from "@/lib/api";

export default function ClaimPage() {
  const router = useRouter();
  const [user, setUser] = useState<MeUser | null | undefined>(undefined);
  const [ageAttested, setAgeAttested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMe().then(setUser);
  }, []);

  async function submit() {
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/claim/attest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ageAttested: true, publicnessAck: true }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json?.error?.message ?? "Something went wrong");
      return;
    }
    const me = await fetchMe();
    setUser(me);
  }

  if (user === undefined) return <div className="text-center text-[var(--ink-dim)] py-12">Loading...</div>;

  if (!user) {
    return (
      <div className="ticket p-6 flex flex-col gap-4 items-center text-center">
        <h1 className="text-xl font-semibold">Claim your record</h1>
        <p className="text-sm text-[var(--ink-dim)]">Sign in to keep everything your ghost earned.</p>
        <a href="/api/claim/start" className="rounded-lg border border-[var(--border)] px-4 py-2 font-medium">
          Continue with Google
        </a>
      </div>
    );
  }

  if (user.kind === "claimed") {
    return (
      <div className="ticket p-6 flex flex-col gap-4 items-center text-center">
        <div className="stamp numeral text-2xl" style={{ color: "var(--win)" }}>CLAIMED</div>
        <p>Welcome, {user.handle}. Your record is now yours forever.</p>
        <button
          onClick={() => router.push(`/u/${user.handle}`)}
          className="rounded-lg border border-[var(--border)] px-4 py-2 font-medium"
        >
          View your profile
        </button>
      </div>
    );
  }

  // kind === 'pending'
  return (
    <div className="ticket p-6 flex flex-col gap-4">
      <h1 className="text-xl font-semibold">One more step, {user.handle}</h1>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={ageAttested} onChange={(e) => setAgeAttested(e.target.checked)} className="mt-1" />
        I am 18 or older.
      </label>
      <p className="text-xs text-[var(--ink-dim)]">
        Your picks, record, and rating are public. You can stay pseudonymous forever.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        disabled={!ageAttested || submitting}
        onClick={submit}
        className="rounded-lg border-2 border-[var(--win)] text-[var(--win)] px-4 py-3 font-semibold disabled:opacity-40"
      >
        {submitting ? "Claiming..." : "Claim my record"}
      </button>
    </div>
  );
}
