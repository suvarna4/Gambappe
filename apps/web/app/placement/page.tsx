import type { Metadata } from 'next';
import { isFlagEnabled, PRODUCT_NAME } from '@receipts/core';
import PlacementClient from './PlacementClient';

/**
 * `/placement` (design doc §10.1 route table: client-rendered — no SSR data, unlike the
 * ISR/SSR public pages). WS7-T10: the 5-tap placement flow with a per-item mini-reveal after
 * each answer (§8.7), consuming the already-shipped WS4-T8 `GET /placement` /
 * `POST /placement/answers` API. All data fetching happens client-side in `PlacementClient`.
 */
export const metadata: Metadata = {
  title: `Placement — ${PRODUCT_NAME}`,
};

export default function PlacementPage() {
  // SW6-T1: the swipe deck reuses the daily flag; off keeps today's tap-button placement.
  return <PlacementClient swipeBallot={isFlagEnabled('swipe_ballot')} />;
}
