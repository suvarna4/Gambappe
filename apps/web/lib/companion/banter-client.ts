/**
 * Browser-side fetch for `CompanionBanter` (docs/xtrace-hackathon-tasks.md XH-T6). Extracted
 * from the island so it can be unit-tested directly (this repo has no jsdom/@testing-library —
 * mount-effect behavior is e2e-only, per `nemesis-components.test.tsx`'s convention).
 *
 * `request()` (`lib/pick-client.ts`) THROWS `ApiClientError` on non-2xx, JSON-parse failure,
 * schema-validation failure, and network error — it never returns a sentinel — so this wrapper
 * is the only thing that can satisfy the island's "render nothing on any failure" rule. Bare
 * `request()` cannot: a caller using it directly would need its own try/catch anyway, and would
 * bypass the envelope-unwrap-into-`banter` step this function exists to prove.
 */
import { getBanterResponseSchema, type GetBanterResponse } from '@receipts/core';
import { request } from '@/lib/pick-client';

export async function fetchCompanionBanter(
  pairingId: string,
): Promise<GetBanterResponse['banter'] | null> {
  try {
    const { data } = await request(
      `/api/v1/pairings/${encodeURIComponent(pairingId)}/banter`,
      { method: 'GET' },
      getBanterResponseSchema,
    );
    return data.banter;
  } catch {
    return null;
  }
}
