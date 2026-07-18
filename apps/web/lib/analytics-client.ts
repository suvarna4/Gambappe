/**
 * Client-side analytics emission (design doc §13.1: `POST /api/v1/events`, fire-and-forget).
 * Never throws, never awaited by callers — a failed analytics call must never break the UI
 * flow it's describing.
 */
import type { AnalyticsEventName } from '@receipts/core';

export function postAnalyticsEvent(event: AnalyticsEventName, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return;
  fetch('/api/v1/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event, props: props ?? {} }),
    keepalive: true,
  }).catch(() => {
    // Fire-and-forget (§13.1) — swallow network errors; analytics is never load-bearing.
  });
}
