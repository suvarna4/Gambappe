'use client';

import { useState } from 'react';
import type { MarketSide } from '@receipts/core';
import { PlacementSwipeCard } from '@/app/placement/PlacementSwipeCard';

/** SW6-T1 · Local, network-free harness for the placement swipe card in `/dev/ui`. */
export default function PlacementSwipeGalleryDemo() {
  const [picked, setPicked] = useState<MarketSide | null>(null);
  return (
    <div className="bg-bg rounded-md p-6">
      <div className="mx-auto max-w-[300px] space-y-2">
        <PlacementSwipeCard
          category="ECON"
          title="Did the Fed cut rates last September?"
          yesLabel="CUTS"
          noLabel="HOLDS"
          onPick={setPicked}
        />
        <p className="text-muted text-center font-mono text-xs" data-testid="placement-demo-result">
          {picked ? `called: ${picked}` : 'swipe or tap to call it'}
        </p>
      </div>
    </div>
  );
}
