import { Suspense } from 'react';
import { isFlagEnabled } from '@receipts/core';
import CurationClient from './CurationClient';

export default function CuratePage() {
  // Server-read flag → prop, exactly like the other flag-gated surfaces. Off → the topic-publish
  // affordance never renders (WS18-T1 AC).
  const topicMarketsEnabled = isFlagEnabled('topic_markets');
  return (
    <Suspense fallback={null}>
      <CurationClient topicMarketsEnabled={topicMarketsEnabled} />
    </Suspense>
  );
}
