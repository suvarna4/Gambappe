/**
 * Client-side (browser) logic for `CalloutDraftButton` (docs/xtrace-hackathon-tasks.md XH-T7),
 * split out of the component so it's unit-testable without a DOM (this repo has no
 * jsdom/@testing-library — see `share-client.test.ts`'s header comment for the established
 * convention). `fetchCalloutDrafts` mirrors T6's `fetchCompanionBanter` (fetch → envelope-unwrap
 * → parse, degrading to `null` on any failure). `createAndShareCallout` is the button's full
 * click-to-share flow: mint a fresh challenge link exactly like the plain `CalloutButton` does,
 * then share it together with the selected draft text via the extracted `shareCalloutLink`.
 */
import { draftCalloutResponseSchema } from '@receipts/core';
import { request } from '@/lib/pick-client';
import { shareCalloutLink } from '@/lib/callout-share';

export async function fetchCalloutDrafts(targetProfileId: string): Promise<string[] | null> {
  try {
    const { data } = await request(
      '/api/v1/callouts/draft',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target_profile_id: targetProfileId }),
      },
      draftCalloutResponseSchema,
    );
    return data.drafts;
  } catch {
    return null;
  }
}

interface CalloutCreateResponseWire {
  data?: { share_url?: string };
  error?: { message?: string };
}

/**
 * Creates a fresh challenge link (same `POST /api/v1/callouts` call `CalloutButton` makes, with
 * the same empty body) then shares it together with `selectedDraft` via `shareCalloutLink`.
 * Returns true when the clipboard fallback was taken (mirrors `shareCalloutLink`'s own return).
 */
export async function createAndShareCallout(
  candidateHandle: string,
  selectedDraft: string,
): Promise<boolean> {
  const res = await fetch('/api/v1/callouts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({}),
  });
  const body = (await res.json()) as CalloutCreateResponseWire;
  const shareUrl = body.data?.share_url;
  if (!res.ok || !shareUrl) throw new Error(body.error?.message ?? 'callout create failed');

  return shareCalloutLink(shareUrl, `Call-out: ${candidateHandle}`, selectedDraft);
}
