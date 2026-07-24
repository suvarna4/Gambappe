/**
 * Rivalry banter logic for `GET /api/v1/pairings/:id/banter` (docs/xtrace-hackathon-tasks.md
 * XH-T6). The route stays thin (auth/rate-limit/flag checks that must return a `NextResponse`);
 * everything else — pairing load + participant guard, cache lookup, `BanterContext` assembly,
 * generation, caching — lives here (mirrors the callouts route → `lib/callouts.ts` split).
 *
 * `getXtraceClient`/`getGenerator` are the module-level lazy singletons the spec calls for; the
 * actual work (`generateAndCacheBanter`) takes them as parameters so tests can inject fakes (or
 * a real `createGenerator` over a fake Anthropic client, for the money-word-safety AC) without
 * touching env vars.
 */
import {
  ApiError,
  addDaysToDateString,
  etDateString,
  now,
  COMPANION_MODEL,
  COMPANION_PROMPT_VERSION,
} from '@receipts/core';
import {
  banterCacheKey,
  completedPairingIdsBetween,
  getArtifactByCacheKey,
  getFullPairingSharedQuestionPicks,
  getPairingById,
  getProfileById,
  insertArtifactIdempotent,
  lifetimeRecordBetween,
  listXtraceGroupIdsForPairings,
  mostRecentCompletedPairingBetween,
  type CompanionArtifactContent,
  type Db,
  type NemesisPairingRow,
} from '@receipts/db';
import { scoreNemesisWeek } from '@receipts/engine';
import {
  generatorFromEnv,
  xtraceClientFromEnv,
  type BanterContext,
  type Generator,
  type XtraceClient,
} from '@receipts/companion';

// --- Module-level lazy singletons (spec: "a module-level lazy singleton in lib/companion/
// banter.ts is fine") — resolved once from env, memoized including the `null` (unconfigured)
// case so every request doesn't re-read process.env. ---

let xtraceClientCache: XtraceClient | null | undefined;
export function getXtraceClient(): XtraceClient | null {
  if (xtraceClientCache === undefined) xtraceClientCache = xtraceClientFromEnv();
  return xtraceClientCache;
}

let generatorCache: Generator | null | undefined;
export function getGenerator(): Generator | null {
  if (generatorCache === undefined) generatorCache = generatorFromEnv();
  return generatorCache;
}

export interface BanterArtifact {
  lines: string[];
  generated_at: string;
}

/**
 * Loads the pairing and enforces the participant guard (step 3): `NOT_FOUND` for an unknown
 * pairing, `FORBIDDEN` for a claimed caller who isn't one of its own two players — mirrors
 * `lib/nemesis/reactions.ts`'s existing convention for this exact rejection order.
 */
export async function loadPairingForBanter(
  db: Db,
  pairingId: string,
  viewerProfileId: string,
): Promise<NemesisPairingRow> {
  const pairing = await getPairingById(db, pairingId);
  if (!pairing) throw new ApiError('NOT_FOUND', 'no such pairing');
  if (viewerProfileId !== pairing.profileAId && viewerProfileId !== pairing.profileBId) {
    throw new ApiError('FORBIDDEN', "only the pairing's own two players can view its banter");
  }
  return pairing;
}

/**
 * Step 4: cache lookup ONLY — never consumes the `companion_banter` rate budget. `generated_at`
 * is always the stored artifact row's `createdAt` (never `now()`), so a cache hit reflects when
 * the banter was actually generated.
 */
export async function getBanterCacheHit(
  db: Db,
  pairing: Pick<NemesisPairingRow, 'id'>,
  viewerProfileId: string,
  etDay: string,
): Promise<BanterArtifact | null> {
  const cacheKey = banterCacheKey(pairing.id, viewerProfileId, etDay);
  const artifact = await getArtifactByCacheKey(db, cacheKey);
  if (!artifact) return null;
  return { lines: artifact.content.lines ?? [], generated_at: artifact.createdAt.toISOString() };
}

function opponentIdOf(
  pairing: Pick<NemesisPairingRow, 'profileAId' | 'profileBId'>,
  viewerProfileId: string,
): string {
  return pairing.profileAId === viewerProfileId ? pairing.profileBId : pairing.profileAId;
}

/** ET calendar days from `today` up to and including `weekEndDate`, clamped to ≥ 0. */
function daysRemainingInclusive(today: string, weekEndDate: string): number {
  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  const endMs = new Date(`${weekEndDate}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((endMs - todayMs) / 86_400_000));
}

/** `verdict.narration[profileId]?.line` from a `nemesis_pairings.verdict` jsonb blob (written by
 * `nemesis:conclude` — see XH-T5's verdict-shape note; the field stays untyped at the schema
 * level like every other jsonb column in this repo). */
function narrationLineFor(verdict: unknown, profileId: string): string | null {
  const parsed = verdict as { narration?: Record<string, { line: string } | undefined> } | null;
  return parsed?.narration?.[profileId]?.line ?? null;
}

async function buildBanterContext(
  db: Db,
  xtrace: XtraceClient | null,
  pairing: NemesisPairingRow,
  viewerProfileId: string,
  opponentProfileId: string,
  viewerHandle: string,
  opponentHandle: string,
  at: Date,
): Promise<BanterContext> {
  const record = await lifetimeRecordBetween(db, viewerProfileId, opponentProfileId);

  let currentWeek: BanterContext['currentWeek'] = null;
  if (pairing.status === 'active') {
    const weekEnd = addDaysToDateString(pairing.weekStart, 6);
    const shared = await getFullPairingSharedQuestionPicks(
      db,
      { id: pairing.id, weekStart: pairing.weekStart, weekEnd },
      pairing.profileAId,
      pairing.profileBId,
    );
    const { scoreA, scoreB } = scoreNemesisWeek(
      shared.map((q) => ({
        questionId: q.questionId,
        isVoid: q.isVoid,
        isSettled: q.isSettled,
        profileA: q.profileAPick,
        profileB: q.profileBPick,
      })),
    );
    const viewerIsA = pairing.profileAId === viewerProfileId;
    currentWeek = {
      scoreViewer: viewerIsA ? scoreA : scoreB,
      scoreOpponent: viewerIsA ? scoreB : scoreA,
      daysRemaining: daysRemainingInclusive(etDateString(at), weekEnd),
    };
  }

  const recentCompleted = await mostRecentCompletedPairingBetween(
    db,
    viewerProfileId,
    opponentProfileId,
  );
  const lastVerdictLine = recentCompleted
    ? narrationLineFor(recentCompleted.verdict, viewerProfileId)
    : null;

  const pairingIds = new Set([
    ...(await completedPairingIdsBetween(db, viewerProfileId, opponentProfileId)),
    pairing.id,
  ]);
  const memory = xtrace
    ? await xtrace.search({
        query: `${opponentHandle} rivalry banter grudges history`,
        groupIds: await listXtraceGroupIdsForPairings(db, [...pairingIds]),
        include: ['fact', 'episode'],
      })
    : [];

  return {
    viewerHandle,
    opponentHandle,
    record,
    currentWeek,
    lastVerdictLine,
    memory: memory.map((m) => m.text),
  };
}

/**
 * Steps 6–8: builds the context, calls the generator, and (on a non-null result) caches it —
 * `insertArtifactIdempotent` covers a concurrent double-generate, so the STORED row's lines are
 * always what's returned, never the freshly-generated ones (both racers converge on one row).
 * `xtrace: null` degrades MEMORY to `[]`; `generator: null` short-circuits to `null` before any
 * DB/xTrace work, matching a null `.banter()` result.
 */
export async function generateAndCacheBanter(
  db: Db,
  xtrace: XtraceClient | null,
  generator: Generator | null,
  pairing: NemesisPairingRow,
  viewerProfileId: string,
  etDay: string,
  at: Date = now(),
): Promise<BanterArtifact | null> {
  if (!generator) return null;

  const opponentProfileId = opponentIdOf(pairing, viewerProfileId);
  const [viewer, opponent] = await Promise.all([
    getProfileById(db, viewerProfileId),
    getProfileById(db, opponentProfileId),
  ]);
  const viewerHandle = viewer?.handle ?? viewerProfileId;
  const opponentHandle = opponent?.handle ?? opponentProfileId;

  const ctx = await buildBanterContext(
    db,
    xtrace,
    pairing,
    viewerProfileId,
    opponentProfileId,
    viewerHandle,
    opponentHandle,
    at,
  );
  const lines = await generator.banter(ctx);
  if (!lines) return null;

  const content: CompanionArtifactContent = {
    lines,
    model: COMPANION_MODEL,
    promptVersion: COMPANION_PROMPT_VERSION,
  };
  const cacheKey = banterCacheKey(pairing.id, viewerProfileId, etDay);
  const artifact = await insertArtifactIdempotent(db, {
    kind: 'banter',
    cacheKey,
    profileId: viewerProfileId,
    pairingId: pairing.id,
    content,
  });
  return { lines: artifact.content.lines ?? lines, generated_at: artifact.createdAt.toISOString() };
}
