'use client';

import { useState } from 'react';
import type { QuestionPublic } from '@receipts/core';
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

  return (
    <div className="bg-bg rounded-md p-6">
      <div className="mx-auto max-w-[280px]">
        <SwipeBallot
          question={DEMO_Q}
          ageGateRequired={false}
          pick={pick}
          undoable={pick !== null}
          onPick={(side) =>
            setPick({
              pickId: 'demo',
              side,
              pickedAtIso: DEMO_Q.open_at,
              undoUntilIso: DEMO_Q.lock_at,
            })
          }
          onUndo={() => setPick(null)}
        />
      </div>
    </div>
  );
}
