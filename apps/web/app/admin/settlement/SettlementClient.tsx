'use client';

/**
 * Settlement/void/regrade overrides (§15.3, WS10-T3). Minimal per-question action form — this
 * repo's admin surfaces stay deliberately unpolished (matches WS10-T4's ModerationClient, the
 * curation page): the deliverable is the actions actually working correctly, not a listing UI.
 * The admin pastes in a question id (from the ops dashboard's question timeline, WS10-T5, or
 * the curation preview) rather than this page maintaining its own query/list surface.
 */
import { useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Outcome = 'yes' | 'no';

export default function SettlementClient() {
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

  const [questionId, setQuestionId] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('yes');
  const [typedConfirm, setTypedConfirm] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: 'settle' | 'void' | 'regrade') {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body =
        action === 'void' ? { reason } : { outcome };
      const res = await authedFetch(`/api/admin/questions/${questionId}/${action}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok) setResult(JSON.stringify(json.data));
      else setError(json.error?.message ?? `Failed to ${action}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // §15.3: force-settle/regrade require the admin to TYPE the outcome as a confirmation step,
  // not just click a pre-filled radio — this is the deliberate "did you mean this" friction.
  const confirmed = typedConfirm.trim().toLowerCase() === outcome;

  return (
    <main>
      <h1>Settlement overrides</h1>
      <p>Paste the question id (from the ops dashboard or curation preview) to act on it.</p>

      <label>
        Question id
        <input value={questionId} onChange={(e) => setQuestionId(e.target.value)} />
      </label>

      <fieldset>
        <legend>Force-settle / regrade outcome</legend>
        <label>
          <input type="radio" checked={outcome === 'yes'} onChange={() => setOutcome('yes')} /> Yes
        </label>
        <label>
          <input type="radio" checked={outcome === 'no'} onChange={() => setOutcome('no')} /> No
        </label>
        <label>
          Type &quot;{outcome}&quot; to confirm
          <input value={typedConfirm} onChange={(e) => setTypedConfirm(e.target.value)} />
        </label>
      </fieldset>

      <button type="button" disabled={busy || !questionId || !confirmed} onClick={() => submit('settle')}>
        Force-settle
      </button>
      <button type="button" disabled={busy || !questionId || !confirmed} onClick={() => submit('regrade')}>
        Regrade
      </button>

      <fieldset>
        <legend>Void</legend>
        <label>
          Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </fieldset>
      <button type="button" disabled={busy || !questionId || !reason} onClick={() => submit('void')}>
        Void
      </button>

      {result && <p>Success: {result}</p>}
      {error && <p role="alert">Error: {error}</p>}
    </main>
  );
}
