/**
 * Glicko-2 ratings (design doc §8.3, Glickman's paper). Pure, no clock reads — a rating period's
 * games are supplied by the caller. Rating scale defaults: r=1500, RD=350, vol=0.06.
 */
import { GLICKO_TAU } from '@receipts/core';

/** Glicko-1 scale conversion factor (Glickman's paper, step 2). */
const RATING_SCALE = 173.7178;
export const GLICKO_DEFAULT_RATING = 1500;
export const GLICKO_DEFAULT_RD = 350;
export const GLICKO_DEFAULT_VOL = 0.06;
const DEFAULT_EPSILON = 1e-6;

export interface GlickoRating {
  rating: number;
  rd: number;
  vol: number;
}

/** Rating + RD only — what `expectedScore` needs; volatility plays no role in the E() formula. */
export type GlickoRatingLike = Pick<GlickoRating, 'rating' | 'rd'>;

/** One game played in the rating period, from the updating player's perspective. */
export interface GlickoGame {
  opponentRating: number;
  opponentRd: number;
  /** 1 = win, 0.5 = draw, 0 = loss. */
  score: 0 | 0.5 | 1;
}

export interface GlickoOptions {
  tau?: number;
  epsilon?: number;
}

function toMu(rating: number): number {
  return (rating - GLICKO_DEFAULT_RATING) / RATING_SCALE;
}

function toPhi(rd: number): number {
  return rd / RATING_SCALE;
}

function fromMu(mu: number): number {
  return mu * RATING_SCALE + GLICKO_DEFAULT_RATING;
}

function fromPhi(phi: number): number {
  return phi * RATING_SCALE;
}

/** g(φ) — reduces the impact of an opponent's rating deviation (Glickman's paper, step 3). */
function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** E(μ, μ_j, φ_j) — expected score against one opponent on the Glicko-2 internal scale. */
function expectedScoreInternal(mu: number, muOpponent: number, phiOpponent: number): number {
  return 1 / (1 + Math.exp(-g(phiOpponent) * (mu - muOpponent)));
}

/**
 * Standard Glicko expected win probability between two rated players (used by the nemesis
 * matcher's fairness telemetry, §8.4). Combines both players' rating deviations — the usual
 * extension of the single-opponent E() formula to a symmetric pairwise prediction.
 */
export function expectedScore(a: GlickoRatingLike, b: GlickoRatingLike): number {
  const muA = toMu(a.rating);
  const muB = toMu(b.rating);
  const combinedPhi = Math.sqrt(toPhi(a.rd) ** 2 + toPhi(b.rd) ** 2);
  return expectedScoreInternal(muA, muB, combinedPhi);
}

/** RD-only inflation for a rating period with zero games (Glickman's paper, "Step 6" note). */
function inflateForNoGames(player: GlickoRating): GlickoRating {
  const phi = toPhi(player.rd);
  const phiStar = Math.sqrt(phi * phi + player.vol * player.vol);
  return { rating: player.rating, rd: fromPhi(phiStar), vol: player.vol };
}

/**
 * Solves for the new volatility σ' via the Illinois algorithm (Glickman's paper, step 5).
 */
function solveNewVolatility(
  phi: number,
  v: number,
  delta: number,
  vol: number,
  tau: number,
  epsilon: number,
): number {
  const a = Math.log(vol * vol);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const denom = 2 * (phi * phi + v + ex) ** 2;
    return num / denom - (x - a) / (tau * tau);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);

  while (Math.abs(B - A) > epsilon) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  return Math.exp(A / 2);
}

/**
 * Updates one player's rating over a rating period (§8.3). `games` = the period's completed
 * games from this player's perspective; an empty list takes the RD-only inflation branch.
 */
export function updateGlicko2(
  player: GlickoRating,
  games: readonly GlickoGame[],
  opts: GlickoOptions = {},
): GlickoRating {
  const tau = opts.tau ?? GLICKO_TAU;
  const epsilon = opts.epsilon ?? DEFAULT_EPSILON;

  if (games.length === 0) {
    return inflateForNoGames(player);
  }

  const mu = toMu(player.rating);
  const phi = toPhi(player.rd);

  let vInverse = 0;
  let deltaSum = 0;
  for (const game of games) {
    const muJ = toMu(game.opponentRating);
    const phiJ = toPhi(game.opponentRd);
    const gj = g(phiJ);
    const ej = expectedScoreInternal(mu, muJ, phiJ);
    vInverse += gj * gj * ej * (1 - ej);
    deltaSum += gj * (game.score - ej);
  }
  const v = 1 / vInverse;
  const delta = v * deltaSum;

  const newVol = solveNewVolatility(phi, v, delta, player.vol, tau, epsilon);

  const phiStar = Math.sqrt(phi * phi + newVol * newVol);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  return {
    rating: fromMu(newMu),
    rd: fromPhi(newPhi),
    vol: newVol,
  };
}
