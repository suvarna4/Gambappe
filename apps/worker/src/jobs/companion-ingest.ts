/**
 * `companion:ingest` (XH-T5, docs/xtrace-hackathon-tasks.md): ships concluded-rivalry material
 * into xTrace so retrieval (T6/T8) has something to find. Runs entirely off the request path,
 * behind the `companion` flag, and is fully fail-open — an xTrace outage degrades to skipped
 * sources retried next run, never a thrown error.
 *
 * Two source types share one run:
 *  1. Concluded pairing verdicts (`nemesis_pairings.verdict IS NOT NULL`) — two ingest calls
 *     per pairing, one per side, so each profile owns its own memory of the rivalry.
 *  2. Visible pairing-thread posts, PII-scrubbed — one ingest call per post.
 *
 * `MAX_SOURCES_PER_RUN` is a SINGLE budget shared across both source types (verdicts fill it
 * first, posts take whatever's left), and a circuit breaker aborts the run on sustained xTrace
 * failure — see `pastDeadline`/`attemptIngest` below. Never touches picks, open questions,
 * emails, or `users`.
 */
import { isFlagEnabled, now } from '@receipts/core';
import {
  filterUningested,
  getProfileById,
  listCandidatePairingPostsForIngest,
  listConcludedPairingsWithVerdict,
  markIngested,
  type CompanionPostIngestCandidate,
  type Db,
} from '@receipts/db';
import {
  pairingConvId,
  pairingGroupId,
  scrubPii,
  xtraceClientFromEnv,
  type IngestArgs,
  type XtraceClient,
} from '@receipts/companion';
import type { JobContext } from '../context.js';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';
import { ownNarrationLine } from '../lib/verdict-narration.js';

/** Shared cap across both source types per run — keeps a backlog from making the job
 * long-running (docs/xtrace-hackathon-tasks.md XH-T5). */
const MAX_SOURCES_PER_RUN = 200;
/** Circuit breaker: abort after this many consecutive `ingest()` failures (calls, not sources —
 * spans the two per-side calls within one pairing). */
const MAX_CONSECUTIVE_FAILURES = 5;
/** Circuit breaker: abort once the run exceeds this wall-clock budget from `at`. Without this,
 * an xTrace outage burns ~10s per retried-timeout call and 200 sources × 2 calls is an hour of
 * sequential failures — past pg-boss's job expiration into concurrent re-delivery. */
const RUN_DEADLINE_MS = 5 * 60_000;

export interface CompanionIngestReport {
  pairingsIngested: number;
  pairingsSkipped: number;
  postsIngested: number;
  postsSkipped: number;
  aborted: boolean;
}

interface RunState {
  consecutiveFailures: number;
  aborted: boolean;
}

/** Checks the wall-clock deadline AND folds in an already-tripped circuit breaker, so every
 * call site can gate on this one function regardless of which limit fired. */
function pastDeadline(at: Date, state: RunState): boolean {
  if (state.aborted) return true;
  if (now().getTime() - at.getTime() >= RUN_DEADLINE_MS) {
    state.aborted = true;
    return true;
  }
  return false;
}

async function attemptIngest(
  xtrace: XtraceClient,
  args: IngestArgs,
  state: RunState,
): Promise<boolean> {
  const ok = await xtrace.ingest(args);
  if (ok) {
    state.consecutiveFailures = 0;
  } else {
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      state.aborted = true;
    }
  }
  return ok;
}

interface ConcludedPairing {
  id: string;
  profileAId: string;
  profileBId: string;
  scoreA: number;
  scoreB: number;
  winnerProfileId: string | null;
  isRematch: boolean;
  verdict: unknown;
}

function buildVerdictProse(
  pairing: ConcludedPairing,
  side: 'A' | 'B',
  handleA: string,
  handleB: string,
): string {
  const myHandle = side === 'A' ? handleA : handleB;
  const opponentHandle = side === 'A' ? handleB : handleA;
  const myScore = side === 'A' ? pairing.scoreA : pairing.scoreB;
  const opponentScore = side === 'A' ? pairing.scoreB : pairing.scoreA;
  const myProfileId = side === 'A' ? pairing.profileAId : pairing.profileBId;
  const outcome =
    pairing.winnerProfileId === null
      ? 'ended in a draw'
      : pairing.winnerProfileId === myProfileId
        ? 'won'
        : 'lost';
  const rematchNote = pairing.isRematch ? ' (a rematch)' : '';
  const ownLine = ownNarrationLine(pairing.verdict, myProfileId);
  const lineSuffix = ownLine ? ` ${ownLine}` : '';
  return `Rivalry week concluded${rematchNote}: ${myHandle} ${myScore} — ${opponentScore} ${opponentHandle}, ${myHandle} ${outcome}.${lineSuffix}`;
}

function buildVerdictIngestArgs(
  pairing: ConcludedPairing,
  side: 'A' | 'B',
  handleA: string,
  handleB: string,
  at: Date,
): IngestArgs {
  const profileId = side === 'A' ? pairing.profileAId : pairing.profileBId;
  return {
    userId: profileId,
    convId: pairingConvId(pairing.id, profileId),
    groupIds: [pairingGroupId(pairing.id)],
    messages: [
      {
        role: 'user',
        content: buildVerdictProse(pairing, side, handleA, handleB),
        date: at.toISOString(),
      },
    ],
  };
}

async function ingestOnePairingVerdict(
  db: Db,
  xtrace: XtraceClient,
  pairing: ConcludedPairing,
  at: Date,
  state: RunState,
): Promise<boolean> {
  const [profileA, profileB] = await Promise.all([
    getProfileById(db, pairing.profileAId),
    getProfileById(db, pairing.profileBId),
  ]);
  const handleA = profileA?.handle ?? pairing.profileAId;
  const handleB = profileB?.handle ?? pairing.profileBId;

  const okA = await attemptIngest(
    xtrace,
    buildVerdictIngestArgs(pairing, 'A', handleA, handleB, at),
    state,
  );
  // Deadline/circuit check BETWEEN the two per-side calls, not only between pairings.
  if (pastDeadline(at, state)) return false;

  const okB = await attemptIngest(
    xtrace,
    buildVerdictIngestArgs(pairing, 'B', handleA, handleB, at),
    state,
  );

  if (okA && okB) {
    await markIngested(db, [{ sourceKind: 'pairing_verdict', sourceId: pairing.id }]);
    return true;
  }
  // Either side failed — skip marking entirely so BOTH sides retry next run (a half-ingested
  // pairing would otherwise leave one profile's memory permanently missing).
  return false;
}

function buildPostIngestArgs(post: CompanionPostIngestCandidate, at: Date): IngestArgs {
  return {
    userId: post.profileId,
    convId: pairingConvId(post.pairingId, post.profileId),
    groupIds: [pairingGroupId(post.pairingId)],
    messages: [
      {
        role: 'user',
        content: `${post.authorHandle} said in the rivalry thread: ${scrubPii(post.body)}`,
        date: at.toISOString(),
      },
    ],
  };
}

async function ingestOnePost(
  db: Db,
  xtrace: XtraceClient,
  post: CompanionPostIngestCandidate,
  at: Date,
  state: RunState,
): Promise<boolean> {
  const ok = await attemptIngest(xtrace, buildPostIngestArgs(post, at), state);
  if (ok) {
    await markIngested(db, [{ sourceKind: 'post', sourceId: post.id }]);
  }
  return ok;
}

export async function runCompanionIngest(
  ctx: JobContext,
  xtrace: XtraceClient,
  at: Date = now(),
): Promise<CompanionIngestReport> {
  const report: CompanionIngestReport = {
    pairingsIngested: 0,
    pairingsSkipped: 0,
    postsIngested: 0,
    postsSkipped: 0,
    aborted: false,
  };
  const state: RunState = { consecutiveFailures: 0, aborted: false };

  // Source 1: concluded pairing verdicts fill the shared budget first.
  const allConcludedPairings = await listConcludedPairingsWithVerdict(ctx.db);
  const uningestedPairingIds = new Set(
    await filterUningested(
      ctx.db,
      'pairing_verdict',
      allConcludedPairings.map((p) => p.id),
    ),
  );
  const pairingCandidates = allConcludedPairings
    .filter((p) => uningestedPairingIds.has(p.id))
    .slice(0, MAX_SOURCES_PER_RUN);

  for (const pairing of pairingCandidates) {
    if (pastDeadline(at, state)) break;
    const ingested = await ingestOnePairingVerdict(ctx.db, xtrace, pairing, at, state);
    if (ingested) report.pairingsIngested += 1;
    else report.pairingsSkipped += 1;
    if (state.aborted) break;
  }

  // Source 2: pairing-thread posts fill whatever budget remains.
  const remainingBudget = MAX_SOURCES_PER_RUN - pairingCandidates.length;
  if (remainingBudget > 0 && !state.aborted) {
    const allCandidatePosts = await listCandidatePairingPostsForIngest(ctx.db);
    const uningestedPostIds = new Set(
      await filterUningested(
        ctx.db,
        'post',
        allCandidatePosts.map((p) => p.id),
      ),
    );
    const postCandidates = allCandidatePosts
      .filter((p) => uningestedPostIds.has(p.id))
      .slice(0, remainingBudget);

    for (const post of postCandidates) {
      if (pastDeadline(at, state)) break;
      const ingested = await ingestOnePost(ctx.db, xtrace, post, at, state);
      if (ingested) report.postsIngested += 1;
      else report.postsSkipped += 1;
      if (state.aborted) break;
    }
  }

  report.aborted = state.aborted;
  return report;
}

export const companionIngestHandler: JobHandler = async (ctx) => {
  if (!isFlagEnabled('companion')) {
    logger.debug('companion:ingest skipped — companion flag disabled');
    return;
  }
  const xtrace = xtraceClientFromEnv();
  if (!xtrace) {
    logger.debug('companion:ingest skipped — xTrace unconfigured');
    return;
  }
  const report = await runCompanionIngest(ctx, xtrace);
  logger.info({ report }, 'companion:ingest complete');
};
