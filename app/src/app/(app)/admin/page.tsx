"use client";

import { useEffect, useState } from "react";

interface AdminQuestion {
  id: string;
  headline: string;
  status: string;
  questionDate: string | null;
  venue: string;
  venueMarketId: string;
  venueUrl: string;
  outcome: string | null;
}
interface AdminPairing {
  id: string;
  userA: string;
  userB: string;
  status: string;
  scoreA: number;
  scoreB: number;
}
interface AdminUser {
  id: string;
  handle: string;
  kind: string;
  botSuspect: boolean;
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...opts, headers: { "content-type": "application/json", ...(opts?.headers ?? {}) } });
  return res.json();
}

export default function AdminPage() {
  const [state, setState] = useState<{ questions: AdminQuestion[]; pairings: AdminPairing[]; users: AdminUser[] } | null>(
    null
  );
  const [form, setForm] = useState({ venue: "fake", venueMarketId: "", headline: "" });
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  async function refresh() {
    const data = await api<typeof state>("/api/admin/state");
    setState(data);
  }

  useEffect(() => {
    refresh();
  }, []);

  function appendLog(msg: string) {
    setLog((l) => [msg, ...l].slice(0, 10));
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      const result = await fn();
      appendLog(`${label}: ${JSON.stringify(result).slice(0, 140)}`);
      await refresh();
    } catch (err) {
      appendLog(`${label} FAILED: ${String(err)}`);
    }
    setBusy(false);
  }

  async function createQuestion() {
    await run("create question", () => api("/api/admin/questions", { method: "POST", body: JSON.stringify(form) }));
    setForm({ ...form, venueMarketId: "", headline: "" });
  }

  return (
    <main className="flex-1 flex flex-col gap-6 pt-4 max-w-[480px]">
      <h1 className="text-xl font-bold">Admin</h1>

      <div className="ticket p-4 flex flex-col gap-2">
        <h2 className="font-semibold text-sm">Curate a question</h2>
        <select
          value={form.venue}
          onChange={(e) => setForm({ ...form, venue: e.target.value })}
          className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-sm"
        >
          <option value="fake">fake</option>
          <option value="kalshi">kalshi</option>
        </select>
        <input
          placeholder="venue market id / ticker"
          value={form.venueMarketId}
          onChange={(e) => setForm({ ...form, venueMarketId: e.target.value })}
          className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-sm"
        />
        <input
          placeholder="headline"
          value={form.headline}
          onChange={(e) => setForm({ ...form, headline: e.target.value })}
          className="bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-sm"
        />
        <button disabled={busy} onClick={createQuestion} className="rounded border border-[var(--border)] py-1.5 text-sm">
          Create draft question
        </button>
      </div>

      <div className="ticket p-4 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <h2 className="font-semibold text-sm">Global actions</h2>
        </div>
        <button
          disabled={busy}
          onClick={() => run("tick", () => api("/api/admin/tick", { method: "POST" }))}
          className="rounded border border-[var(--border)] py-1.5 text-sm"
        >
          Tick now
        </button>
        <button
          disabled={busy}
          onClick={() => run("assign nemeses", () => api("/api/admin/nemesis/assign", { method: "POST" }))}
          className="rounded border border-[var(--border)] py-1.5 text-sm"
        >
          Assign nemeses now
        </button>
      </div>

      <div className="ticket p-4 flex flex-col gap-2">
        <h2 className="font-semibold text-sm">Questions</h2>
        {state?.questions.map((q) => (
          <div key={q.id} className="tear-line pt-2 flex flex-col gap-1 text-sm">
            <div className="truncate">{q.headline}</div>
            <div className="text-xs text-[var(--ink-dim)] flex justify-between">
              <span>
                {q.status} · {q.venue}:{q.venueMarketId}
              </span>
              <a href={q.venueUrl} target="_blank" rel="noopener" className="underline">
                venue →
              </a>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                disabled={busy}
                onClick={() => run("open", () => api(`/api/admin/questions/${q.id}/open`, { method: "POST" }))}
                className="text-xs rounded border border-[var(--border)] px-2 py-1"
              >
                Open
              </button>
              <button
                disabled={busy}
                onClick={() => run("lock", () => api(`/api/admin/questions/${q.id}/lock`, { method: "POST" }))}
                className="text-xs rounded border border-[var(--border)] px-2 py-1"
              >
                Lock
              </button>
              <SettleButton questionId={q.id} busy={busy} onRun={run} />
              <button
                disabled={busy}
                onClick={() => run("reveal", () => api(`/api/admin/questions/${q.id}/reveal`, { method: "POST" }))}
                className="text-xs rounded border border-[var(--border)] px-2 py-1"
              >
                Reveal now
              </button>
              <a href={`/q/${q.id}`} className="text-xs underline self-center">
                view
              </a>
            </div>
          </div>
        ))}
      </div>

      <div className="ticket p-4 flex flex-col gap-2">
        <h2 className="font-semibold text-sm">Nemesis pairings</h2>
        {state?.pairings.map((p) => (
          <div key={p.id} className="tear-line pt-2 text-sm flex justify-between">
            <span>
              {p.status} · {p.scoreA}-{p.scoreB}
            </span>
            <a href={`/vs/${p.id}`} className="underline text-xs">
              view
            </a>
          </div>
        ))}
      </div>

      <div className="ticket p-4 flex flex-col gap-2">
        <h2 className="font-semibold text-sm">Users</h2>
        {state?.users.map((u) => (
          <div key={u.id} className="tear-line pt-2 text-sm flex justify-between items-center">
            <span>
              {u.handle} ({u.kind})
            </span>
            <button
              disabled={busy}
              onClick={() =>
                run("bot-suspect", () =>
                  api(`/api/admin/users/${u.id}/bot-suspect`, {
                    method: "POST",
                    body: JSON.stringify({ botSuspect: !u.botSuspect }),
                  })
                )
              }
              className="text-xs rounded border border-[var(--border)] px-2 py-1"
            >
              {u.botSuspect ? "unflag bot" : "flag bot"}
            </button>
          </div>
        ))}
      </div>

      <div className="ticket p-4 flex flex-col gap-1">
        <h2 className="font-semibold text-sm">Log</h2>
        {log.map((l, i) => (
          <div key={i} className="text-xs text-[var(--ink-dim)] numeral truncate">
            {l}
          </div>
        ))}
      </div>
    </main>
  );
}

function SettleButton({
  questionId,
  busy,
  onRun,
}: {
  questionId: string;
  busy: boolean;
  onRun: (label: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <div className="flex gap-1">
      {(["yes", "no", "void"] as const).map((outcome) => (
        <button
          key={outcome}
          disabled={busy}
          onClick={() => {
            if (!confirm(`Type-confirm: settle as "${outcome}"? This mirrors venue truth.`)) return;
            onRun("settle", () =>
              fetch(`/api/admin/questions/${questionId}/settle`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ outcome }),
              }).then((r) => r.json())
            );
          }}
          className="text-xs rounded border border-[var(--border)] px-2 py-1"
        >
          settle:{outcome}
        </button>
      ))}
    </div>
  );
}
