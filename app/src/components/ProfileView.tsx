import type { PublicProfile, ProfilePickLogRow } from "@/lib/api";

/** §10.2.3 — the creator wedge (PRD §9): track-record header + category chart + pick log. */
export function ProfileView({ profile, picks }: { profile: PublicProfile; picks: ProfilePickLogRow[] }) {
  const accuracyPct = profile.stats.accuracy != null ? Math.round(profile.stats.accuracy * 100) : null;
  const edgePct = profile.stats.edge != null ? Math.round(profile.stats.edge * 100) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="ticket p-6 flex flex-col gap-4 items-center text-center">
        <div className="text-xs uppercase tracking-widest text-[var(--ink-dim)]">
          {profile.kind === "claimed" ? "verified track record" : "ghost record"}
        </div>
        <h1 className="numeral text-2xl font-bold">{profile.handle}</h1>
        <div className="grid grid-cols-2 gap-4 w-full">
          <Stat label="Accuracy" value={accuracyPct != null ? `${accuracyPct}%` : "—"} />
          <Stat label="Edge" value={edgePct != null ? `${edgePct > 0 ? "+" : ""}${edgePct}%` : "—"} />
          <Stat label="Streak" value={String(profile.stats.participationStreak)} />
          <Stat label="Best streak" value={String(profile.stats.bestParticipationStreak)} />
        </div>
      </div>

      {Object.keys(profile.stats.categoryStats).length > 0 && (
        <div className="ticket p-5 flex flex-col gap-2">
          <div className="text-sm font-semibold">By category</div>
          {Object.entries(profile.stats.categoryStats).map(([cat, s]) => (
            <div key={cat} className="flex justify-between text-sm numeral">
              <span className="capitalize text-[var(--ink-dim)]">{cat}</span>
              <span>
                {s.wins}/{s.picks}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="ticket p-5 flex flex-col gap-1">
        <div className="text-sm font-semibold mb-2">Full record</div>
        {picks.length === 0 && <div className="text-sm text-[var(--ink-dim)]">No public picks yet.</div>}
        {picks.map((p, i) => (
          <a
            key={i}
            href={`/q/${p.questionId}`}
            className="flex justify-between items-center text-sm py-2 tear-line first:border-t-0"
          >
            <span className="truncate max-w-[55%]">{p.headline}</span>
            <span className="numeral flex items-center gap-2">
              <span style={{ color: p.side === "yes" ? "var(--side-yes)" : "var(--side-no)" }}>
                {p.side.toUpperCase()} ¢{Math.round(p.entryPrice * 100)}
              </span>
              {p.result && <ResultStamp result={p.result} />}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="numeral text-lg font-bold">{value}</span>
      <span className="text-xs text-[var(--ink-dim)]">{label}</span>
    </div>
  );
}

function ResultStamp({ result }: { result: string }) {
  if (result === "win") return <span style={{ color: "var(--win)" }}>✓</span>;
  if (result === "loss") return <span style={{ color: "var(--loss)" }}>✗</span>;
  if (result === "void") return <span className="text-[var(--ink-dim)]">–</span>;
  return null;
}
