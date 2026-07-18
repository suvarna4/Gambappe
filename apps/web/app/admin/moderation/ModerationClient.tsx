'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface ReportRow {
  id: string;
  reporterProfileId: string;
  reportedProfileId: string | null;
  contextKind: 'post' | 'pairing' | 'duo' | 'profile';
  contextId: string;
  reason: string;
  note: string | null;
  status: string;
  createdAt: string;
}

interface ProfileRow {
  id: string;
  handle: string;
  slug: string;
  status: string;
  botScore: number;
}

type ReportAction = 'dismiss' | 'remove_content' | 'pause' | 'suspend';
type AutoPauseAction = 'restore' | 'suspend';

export default function ModerationClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const authedFetch = useCallback(
    (path: string, init?: RequestInit) => {
      const url = new URL(path, window.location.origin);
      if (token) url.searchParams.set('token', token);
      return fetch(url.toString(), init);
    },
    [token],
  );

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [botFlags, setBotFlags] = useState<ProfileRow[]>([]);
  const [autoPaused, setAutoPaused] = useState<ProfileRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [reportsRes, botFlagsRes, autoPausedRes] = await Promise.all([
        authedFetch('/api/admin/reports'),
        authedFetch('/api/admin/bot-flags'),
        authedFetch('/api/admin/auto-pause'),
      ]);
      const [reportsBody, botFlagsBody, autoPausedBody] = await Promise.all([
        reportsRes.json(),
        botFlagsRes.json(),
        autoPausedRes.json(),
      ]);
      setReports(reportsBody.data ?? []);
      setBotFlags(botFlagsBody.data ?? []);
      setAutoPaused(autoPausedBody.data ?? []);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [authedFetch]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function resolveReport(id: string, action: ReportAction) {
    setBusyId(id);
    try {
      const res = await authedFetch(`/api/admin/reports/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) await loadAll();
      else setError((await res.json()).error?.message ?? 'Failed to resolve report');
    } finally {
      setBusyId(null);
    }
  }

  async function resolveAutoPause(id: string, action: AutoPauseAction) {
    setBusyId(id);
    try {
      const res = await authedFetch(`/api/admin/auto-pause/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) await loadAll();
      else setError((await res.json()).error?.message ?? 'Failed to resolve profile');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <h1 className="text-2xl font-bold">Moderation queues</h1>
      {error && <p className="text-loss text-sm">{error}</p>}

      <section className="space-y-2">
        <h2 className="text-muted text-sm font-semibold uppercase">Reports ({reports.length})</h2>
        {reports.length === 0 && <p className="text-muted text-sm">No open reports.</p>}
        <ul className="space-y-2">
          {reports.map((r) => (
            <li key={r.id} className="bg-surface rounded px-3 py-2 text-sm">
              <div>
                <span className="font-mono text-xs uppercase">{r.contextKind}</span> — {r.reason}
                {r.note && <span className="text-muted"> — &ldquo;{r.note}&rdquo;</span>}
              </div>
              <div className="text-muted text-xs">reported {r.createdAt}</div>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => resolveReport(r.id, 'dismiss')}
                  className="bg-surface rounded border px-2 py-1 text-xs"
                >
                  Dismiss
                </button>
                {r.contextKind === 'post' && (
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => resolveReport(r.id, 'remove_content')}
                    className="bg-surface rounded border px-2 py-1 text-xs"
                  >
                    Remove content
                  </button>
                )}
                {r.reportedProfileId && (
                  <>
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => resolveReport(r.id, 'pause')}
                      className="bg-surface rounded border px-2 py-1 text-xs"
                    >
                      Pause
                    </button>
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => resolveReport(r.id, 'suspend')}
                      className="text-loss bg-surface rounded border px-2 py-1 text-xs"
                    >
                      Suspend
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-muted text-sm font-semibold uppercase">Bot-flag review ({botFlags.length})</h2>
        <p className="text-muted text-xs">Review only — never auto-banned (§14.2).</p>
        <ul className="space-y-1 text-sm">
          {botFlags.map((p) => (
            <li key={p.id}>
              {p.handle} — bot_score {p.botScore.toFixed(2)}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-muted text-sm font-semibold uppercase">Auto-pause review ({autoPaused.length})</h2>
        <p className="text-muted text-xs">Reviewed within 48h (§15.4 runbook SLA).</p>
        <ul className="space-y-2">
          {autoPaused.map((p) => (
            <li key={p.id} className="bg-surface flex items-center justify-between rounded px-3 py-2 text-sm">
              <span>{p.handle}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busyId === p.id}
                  onClick={() => resolveAutoPause(p.id, 'restore')}
                  className="bg-surface rounded border px-2 py-1 text-xs"
                >
                  Restore
                </button>
                <button
                  type="button"
                  disabled={busyId === p.id}
                  onClick={() => resolveAutoPause(p.id, 'suspend')}
                  className="text-loss bg-surface rounded border px-2 py-1 text-xs"
                >
                  Suspend
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
