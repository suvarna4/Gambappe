/**
 * `/admin` shell (§15.1, WS10-T1). Gated entirely by middleware.ts — reaching this
 * component at all means the stopgap auth check already passed. Curation (WS10-T2),
 * settlement/void/regrade (WS10-T3), moderation queues (WS10-T4), and the ops dashboard
 * (WS10-T5) build their panels here.
 */
import { PRODUCT_NAME } from '@receipts/core';
export default function AdminHomePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-bold">{`${PRODUCT_NAME} admin`}</h1>
      <p className="text-muted mt-2 text-sm">
        P0 stopgap auth (bearer token + IP allowlist). Curation, settlement, moderation, and
        the ops dashboard land in WS10-T2..T5.
      </p>
    </main>
  );
}
