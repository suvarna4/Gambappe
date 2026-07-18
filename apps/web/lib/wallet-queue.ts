/**
 * Enqueues `wallet:ingest` (design doc §12.2 step 4, job owned by `apps/worker/src/jobs/
 * wallet-ingest.ts`, WS12-T2). This is the first case of `apps/web` enqueueing a pg-boss job
 * across processes into `apps/worker` — every other transactional enqueue in this codebase
 * (`grade:followup` etc.) happens worker-side, same process as the job it enqueues into.
 * `createQueue` is called defensively before `send` (idempotent — pg-boss's `create_queue` SQL
 * function is `ON CONFLICT DO NOTHING`) so this never depends on `apps/worker` having already
 * booted and registered the queue first; `send` would otherwise fail its queue foreign key.
 *
 * Fire-and-forget by design (§12.2: "Respond immediately... don't block on ingestion") — a
 * `wallet:ingest` enqueue failure must never fail the `/wallet/verify` response the user is
 * waiting on. Callers should swallow/log a rejection here, not propagate it as a request error.
 */
import { getBoss } from './stores';

const QUEUE_NAME = 'wallet:ingest';

export interface WalletIngestJobPayload {
  walletLinkId: string;
}

export async function enqueueWalletIngest(payload: WalletIngestJobPayload): Promise<void> {
  const boss = await getBoss();
  await boss.createQueue(QUEUE_NAME);
  await boss.send(QUEUE_NAME, payload);
}
