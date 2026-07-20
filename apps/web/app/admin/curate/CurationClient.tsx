'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MARKET_CATEGORY, VENUE } from '@receipts/core';

interface MarketRow {
  id: string;
  venue: string;
  title: string;
  category: string;
  closeTime: string;
  yesPrice: number | null;
  nemesisEligible: boolean;
}

interface PreviewQuestion {
  headline: string;
  yes_label: string;
  no_label: string;
  open_at: string;
  lock_at: string;
  reveal_at: string;
  yes_price: number | null;
  slug: string;
}

interface PreviewResponse {
  data: { question: PreviewQuestion | null; errors: string[] };
}

const emptyForm = {
  headline: '',
  blurb: '',
  yes_label: '',
  no_label: '',
  question_date: '',
  is_volatile: false,
  event_start_at: '',
};

export default function CurationClient() {
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

  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [preview, setPreview] = useState<PreviewResponse['data'] | null>(null);
  const [submitResult, setSubmitResult] = useState<string | null>(null);
  // '' = all. The list is soonest-closing-first, so without a venue filter a big same-day
  // batch from one venue (hourly Kalshi sync) fills page after page — filters + cursor
  // pagination are what make the rest of the pool reachable (WS15-T4).
  const [venueFilter, setVenueFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchMarkets = useCallback(
    (cursor: string | null) => {
      const params = new URLSearchParams();
      if (venueFilter) params.set('venue', venueFilter);
      if (categoryFilter) params.set('category', categoryFilter);
      if (cursor) params.set('cursor', cursor);
      setLoadingMore(true);
      return authedFetch(`/api/admin/markets${params.size ? `?${params.toString()}` : ''}`)
        .then((res) => res.json())
        .then(
          (body: {
            data?: MarketRow[];
            meta?: { next_cursor: string | null };
            error?: { message: string };
          }) => {
            if (body.data) {
              const page = body.data;
              // Append on a cursor fetch, replace on a fresh (filter-change) fetch. The id
              // dedupe is defensive: a duplicated row would collide React keys and leave
              // zombie rows behind on the next re-render.
              setMarkets((prev) =>
                cursor
                  ? [...prev, ...page.filter((m) => !prev.some((p) => p.id === m.id))]
                  : page,
              );
              setNextCursor(body.meta?.next_cursor ?? null);
              setMarketsError(null);
            } else {
              setMarketsError(body.error?.message ?? 'Failed to load markets');
            }
          },
        )
        .catch((err: Error) => setMarketsError(err.message))
        .finally(() => setLoadingMore(false));
    },
    [authedFetch, venueFilter, categoryFilter],
  );

  useEffect(() => {
    // Initial load and every filter change start over from page one.
    void fetchMarkets(null);
  }, [fetchMarkets]);

  const previewParams = useMemo(() => {
    if (!selectedMarketId) return null;
    const params = new URLSearchParams({ market_id: selectedMarketId });
    if (form.headline) params.set('headline', form.headline);
    if (form.yes_label) params.set('yes_label', form.yes_label);
    if (form.no_label) params.set('no_label', form.no_label);
    if (form.question_date) params.set('question_date', form.question_date);
    if (form.event_start_at) params.set('event_start_at', new Date(form.event_start_at).toISOString());
    if (form.is_volatile) params.set('is_volatile', 'true');
    return params;
  }, [selectedMarketId, form]);

  useEffect(() => {
    if (!previewParams) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(() => {
      authedFetch(`/api/admin/questions/preview?${previewParams.toString()}`)
        .then((res) => res.json())
        .then((body: PreviewResponse) => setPreview(body.data))
        .catch(() => setPreview(null));
    }, 300); // debounce while the curator is still typing
    return () => clearTimeout(timer);
  }, [previewParams, authedFetch]);

  async function handleSubmit() {
    if (!selectedMarketId) return;
    setSubmitResult(null);
    const body = {
      market_id: selectedMarketId,
      headline: form.headline,
      blurb: form.blurb || null,
      yes_label: form.yes_label,
      no_label: form.no_label,
      question_date: form.question_date,
      is_volatile: form.is_volatile,
      event_start_at: form.event_start_at ? new Date(form.event_start_at).toISOString() : null,
    };
    const res = await authedFetch('/api/admin/questions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { data?: { slug: string }; error?: { message: string } };
    if (res.ok && json.data) {
      setSubmitResult(`Scheduled: ${json.data.slug}`);
      setForm(emptyForm);
      setSelectedMarketId(null);
    } else {
      setSubmitResult(`Error: ${json.error?.message ?? 'unknown'}`);
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <h1 className="text-2xl font-bold">Curate a question</h1>

      <section className="space-y-2">
        <h2 className="text-muted text-sm font-semibold uppercase">Market browser</h2>
        <div className="flex gap-2">
          <select
            aria-label="Venue filter"
            className="bg-surface rounded px-3 py-2 text-sm"
            value={venueFilter}
            onChange={(e) => setVenueFilter(e.target.value)}
          >
            <option value="">All venues</option>
            {VENUE.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select
            aria-label="Category filter"
            className="bg-surface rounded px-3 py-2 text-sm"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All categories</option>
            {MARKET_CATEGORY.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {marketsError && <p className="text-loss text-sm">{marketsError}</p>}
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {markets.map((market) => (
            <button
              key={market.id}
              type="button"
              onClick={() => setSelectedMarketId(market.id)}
              className={`block w-full rounded px-3 py-2 text-left text-sm ${
                selectedMarketId === market.id ? 'bg-side-a/20' : 'bg-surface'
              }`}
            >
              <span className="font-mono text-xs uppercase">{market.venue}</span> — {market.title}{' '}
              <span className="text-muted">({market.category}, closes {market.closeTime})</span>
            </button>
          ))}
          {markets.length === 0 && !marketsError && !loadingMore && (
            <p className="text-muted text-sm">No markets match these filters.</p>
          )}
        </div>
        {nextCursor && (
          <button
            type="button"
            onClick={() => void fetchMarkets(nextCursor)}
            disabled={loadingMore}
            className="bg-surface rounded px-4 py-2 text-sm disabled:opacity-40"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </section>

      {selectedMarketId && (
        <section className="space-y-3">
          <h2 className="text-muted text-sm font-semibold uppercase">Composer</h2>
          <input
            className="bg-surface w-full rounded px-3 py-2 text-sm"
            placeholder="Headline"
            value={form.headline}
            onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))}
          />
          <div className="flex gap-2">
            <input
              className="bg-surface w-full rounded px-3 py-2 text-sm"
              placeholder="Yes label"
              value={form.yes_label}
              onChange={(e) => setForm((f) => ({ ...f, yes_label: e.target.value }))}
            />
            <input
              className="bg-surface w-full rounded px-3 py-2 text-sm"
              placeholder="No label"
              value={form.no_label}
              onChange={(e) => setForm((f) => ({ ...f, no_label: e.target.value }))}
            />
          </div>
          <input
            type="date"
            className="bg-surface w-full rounded px-3 py-2 text-sm"
            value={form.question_date}
            onChange={(e) => setForm((f) => ({ ...f, question_date: e.target.value }))}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_volatile}
              onChange={(e) => setForm((f) => ({ ...f, is_volatile: e.target.checked }))}
            />
            Volatile (live event)
          </label>
          <input
            type="datetime-local"
            className="bg-surface w-full rounded px-3 py-2 text-sm"
            placeholder="Event start (required for sports)"
            value={form.event_start_at}
            onChange={(e) => setForm((f) => ({ ...f, event_start_at: e.target.value }))}
          />

          {preview && preview.errors.length > 0 && (
            <ul className="text-loss space-y-1 text-sm">
              {preview.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          {preview?.question && (
            <div className="bg-paper text-ink rounded-md px-6 py-5">
              <p className="font-mono text-sm">{preview.question.headline}</p>
              <p className="text-xs">
                {preview.question.yes_label} vs {preview.question.no_label} — locks{' '}
                {preview.question.lock_at}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!preview?.question}
            className="bg-side-a rounded px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Schedule question
          </button>
        </section>
      )}
      {submitResult && <p className="text-sm">{submitResult}</p>}
    </main>
  );
}
