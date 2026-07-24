/**
 * `POST /api/v1/callouts/draft` business logic (docs/xtrace-hackathon-tasks.md XH-T7): a few
 * callout-message drafts a challenger could send a past (or current-week) rival, grounded in
 * their lifetime record + shared xTrace memory, cached once per challenger/target/ET-day.
 * The route stays thin; this module owns target authorization, the cache check, memory
 * assembly, and generation/caching — mirrors `lib/companion/banter.ts`'s split. That module's
 * `getXtraceClient`/`getGenerator` singletons are reused directly by the route rather than
 * re-declared here (one lazy client/generator pair for the whole companion surface).
 */
import {
  ApiError,
  COMPANION_MODEL,
  COMPANION_PROMPT_VERSION,
  COMPANION_SEARCH_LIMIT,
} from '@receipts/core';
import {
  calloutDraftCacheKey,
  completedPairingIdsBetween,
  getArtifactByCacheKey,
  getProfileById,
  insertArtifactIdempotent,
  lifetimeRecordBetween,
  listXtraceGroupIdsForPairings,
  type CompanionArtifactContent,
  type Db,
} from '@receipts/db';
import { type Generator, type XtraceClient } from '@receipts/companion';
import { getCalloutCandidates } from '@/lib/callouts-view';

/**
 * Authorized when the challenger has a completed pairing with the target (checked first, and
 * unbounded — unlike `getCalloutCandidates`, which folds only one paginated history page), OR
 * the target appears among the challenger's own call-out candidates (a current-week rival with
 * no completed pairing yet). Returns the (possibly empty) prior-pairing ids so the caller can
 * reuse them for memory scoping without a second fetch.
 */
export async function authorizeDraftTarget(
  db: Db,
  challengerProfileId: string,
  targetProfileId: string,
): Promise<string[]> {
  const priorPairingIds = await completedPairingIdsBetween(
    db,
    challengerProfileId,
    targetProfileId,
  );
  if (priorPairingIds.length > 0) return priorPairingIds;

  const candidates = await getCalloutCandidates(db, challengerProfileId);
  const isCandidate = candidates.some((c) => c.profileId === targetProfileId);
  if (!isCandidate) {
    throw new ApiError('FORBIDDEN', 'no shared history with this target');
  }
  return priorPairingIds;
}

export async function getDraftCacheHit(
  db: Db,
  challengerProfileId: string,
  targetProfileId: string,
  etDay: string,
): Promise<string[] | null> {
  const cacheKey = calloutDraftCacheKey(challengerProfileId, targetProfileId, etDay);
  const artifact = await getArtifactByCacheKey(db, cacheKey);
  return artifact?.content.drafts ?? null;
}

/** Group results first, then user results (concatenation order), de-duped by memory id,
 * truncated to `COMPANION_SEARCH_LIMIT` — per XH-T7 step 7. */
async function searchDraftMemory(
  db: Db,
  xtrace: XtraceClient | null,
  targetHandle: string,
  challengerProfileId: string,
  priorPairingIds: string[],
): Promise<string[]> {
  if (!xtrace) return [];
  const query = `${targetHandle} rivalry trash talk grudges history`;
  const groupIds =
    priorPairingIds.length > 0 ? await listXtraceGroupIdsForPairings(db, priorPairingIds) : [];
  const [groupResults, userResults] = await Promise.all([
    groupIds.length > 0
      ? xtrace.search({
          query,
          groupIds,
          include: ['fact', 'episode'],
        })
      : Promise.resolve([]),
    xtrace.search({ query, userId: challengerProfileId, include: ['fact', 'episode'] }),
  ]);

  const seen = new Set<string>();
  const memory: string[] = [];
  for (const m of [...groupResults, ...userResults]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    memory.push(m.text);
  }
  return memory.slice(0, COMPANION_SEARCH_LIMIT);
}

/**
 * Generates and caches the drafts, throwing `COMPANION_UNAVAILABLE` (503) when generation is
 * unconfigured or fails. Unlike the passive banter panel, the user explicitly clicked here, so
 * silent nothing is worse than an honest error toast (XH-T7 spec).
 */
export async function generateAndCacheCalloutDraft(
  db: Db,
  xtrace: XtraceClient | null,
  generator: Generator | null,
  challengerProfileId: string,
  targetProfileId: string,
  priorPairingIds: string[],
  etDay: string,
): Promise<string[]> {
  if (!generator) throw new ApiError('COMPANION_UNAVAILABLE', 'draft generation unavailable');

  const [challenger, target] = await Promise.all([
    getProfileById(db, challengerProfileId),
    getProfileById(db, targetProfileId),
  ]);
  const challengerHandle = challenger?.handle ?? challengerProfileId;
  const targetHandle = target?.handle ?? targetProfileId;

  const [record, memory] = await Promise.all([
    lifetimeRecordBetween(db, challengerProfileId, targetProfileId),
    searchDraftMemory(db, xtrace, targetHandle, challengerProfileId, priorPairingIds),
  ]);

  const drafts = await generator.calloutDrafts({ challengerHandle, targetHandle, record, memory });
  if (!drafts) throw new ApiError('COMPANION_UNAVAILABLE', 'draft generation unavailable');

  const content: CompanionArtifactContent = {
    drafts,
    model: COMPANION_MODEL,
    promptVersion: COMPANION_PROMPT_VERSION,
  };
  const cacheKey = calloutDraftCacheKey(challengerProfileId, targetProfileId, etDay);
  const artifact = await insertArtifactIdempotent(db, {
    kind: 'callout_draft',
    cacheKey,
    profileId: challengerProfileId,
    pairingId: null,
    seasonId: null,
    content,
  });
  return artifact.content.drafts ?? drafts;
}
