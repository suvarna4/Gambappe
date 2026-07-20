'use client';

import { useState } from 'react';
import type { QuestionPublic } from '@receipts/core';
import { DeckStage } from '@/components/DeckStage';
import { SwipeBallot } from '@/components/SwipeBallot';
import type { CachedPick } from '@/lib/pick-storage';

/** SW1-T2 · Interactive `SwipeBallot` demo for `/dev/ui` — a local, network-free harness so the
 * gesture can be exercised by hand (and screenshotted at rest). Picks resolve to a fake cached
 * pick with a live 60s undo; undo returns the card. No API is called. */
const DEMO_Q: QuestionPublic = {
  id: '018f1e2b-0000-7000-8000-0000000000aa' as QuestionPublic['id'],
  slug: '2026-07-19-fed-cut',
  kind: 'daily',
  status: 'open',
  question_date: '2026-07-19',
  headline: 'Does the Fed cut rates in September?',
  blurb: null,
  yes_label: 'CUTS',
  no_label: 'HOLDS',
  open_at: '2026-07-19T13:00:00Z',
  lock_at: '2026-07-19T16:00:00Z',
  reveal_at: '2026-07-20T00:00:00Z',
  yes_price: 0.71,
  yes_price_updated_at: '2026-07-19T13:00:00Z',
  crowd: null,
  outcome: null,
  revealed_at: null,
  void_reason: null,
  is_volatile: false,
  venue: 'kalshi',
  venue_url: 'https://kalshi.example/markets/demo',
};

export default function SwipeBallotGalleryDemo() {
  const [pick, setPick] = useState<CachedPick | null>(null);

  const ballot = (
    <SwipeBallot
      question={DEMO_Q}
      ageGateRequired={false}
      pick={pick}
      undoable={pick !== null}
      onPick={(side) =>
        setPick({
          pickId: 'demo',
          side,
          pickedAtIso: new Date().toISOString(),
          undoUntilIso: new Date(Date.now() + 60_000).toISOString(),
          yesPriceAtEntry: DEMO_Q.yes_price ?? undefined,
        })
      }
      onUndo={() => setPick(null)}
    />
  );

  // Shown inside the deck stage (SW2-T1) so the rails + stage framing render around the ballot,
  // exactly as the flag-on `open` state composes them on `/` and `/q/[slug]`.
  return (
    <DeckStage
      question={DEMO_Q}
      viewerSlot={ballot}
      underLabel="Tomorrow's question lands at 12:00 AM PT."
    />
  );
}
