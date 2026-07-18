/**
 * WS4-T2 AC: golden vector at stated tolerances; draw scoring; no-game-period RD inflation.
 */
import { describe, expect, it } from 'vitest';
import {
  GLICKO_DEFAULT_RATING,
  GLICKO_DEFAULT_RD,
  GLICKO_DEFAULT_VOL,
  expectedScore,
  updateGlicko2,
} from '../src/glicko2.js';

describe('updateGlicko2 — golden vector (design doc §8.3)', () => {
  it('matches Glickman\'s worked example within the stated tolerances', () => {
    const player = { rating: 1500, rd: 200, vol: 0.06 };
    const result = updateGlicko2(
      player,
      [
        { opponentRating: 1400, opponentRd: 30, score: 1 },
        { opponentRating: 1550, opponentRd: 100, score: 0 },
        { opponentRating: 1700, opponentRd: 300, score: 0 },
      ],
      { tau: 0.5 },
    );

    // design doc tolerances: ±0.01 rating, ±0.01 RD, ±1e-5 vol
    expect(Math.abs(result.rating - 1464.06)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(result.rd - 151.52)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(result.vol - 0.05999)).toBeLessThanOrEqual(1e-5);
  });
});

describe('updateGlicko2 — draw scoring', () => {
  it('a single draw (score=0.5) against an equally-rated opponent barely moves rating', () => {
    const player = { rating: 1500, rd: 200, vol: 0.06 };
    const result = updateGlicko2(player, [{ opponentRating: 1500, opponentRd: 200, score: 0.5 }]);
    expect(result.rating).toBeCloseTo(1500, 0);
    // RD should shrink (more games played -> more certainty) regardless of outcome
    expect(result.rd).toBeLessThan(player.rd);
  });

  it('draws move rating toward the opponent asymmetrically by pre-match strength', () => {
    const underdog = updateGlicko2(
      { rating: 1400, rd: 100, vol: 0.06 },
      [{ opponentRating: 1600, opponentRd: 100, score: 0.5 }],
    );
    const favorite = updateGlicko2(
      { rating: 1600, rd: 100, vol: 0.06 },
      [{ opponentRating: 1400, opponentRd: 100, score: 0.5 }],
    );
    // the lower-rated player gains from a draw against a stronger opponent
    expect(underdog.rating).toBeGreaterThan(1400);
    // the higher-rated player loses from "only" drawing a weaker opponent
    expect(favorite.rating).toBeLessThan(1600);
  });
});

describe('updateGlicko2 — no-game rating period (RD-only inflation)', () => {
  it('rating and volatility are unchanged; RD inflates per the paper', () => {
    const player = { rating: 1500, rd: 60, vol: 0.06 };
    const result = updateGlicko2(player, []);
    expect(result.rating).toBe(player.rating);
    expect(result.vol).toBe(player.vol);
    expect(result.rd).toBeGreaterThan(player.rd);

    // hand-computed: phi'=sqrt(phi^2+vol^2) on the internal scale, converted back
    const RATING_SCALE = 173.7178;
    const phi = player.rd / RATING_SCALE;
    const phiStar = Math.sqrt(phi * phi + player.vol * player.vol);
    expect(result.rd).toBeCloseTo(phiStar * RATING_SCALE, 6);
  });

  it('repeated inactivity keeps inflating RD toward the default ceiling', () => {
    let player = { rating: 1500, rd: 50, vol: 0.06 };
    for (let i = 0; i < 20; i++) player = updateGlicko2(player, []);
    expect(player.rd).toBeGreaterThan(50);
    expect(player.rating).toBe(1500);
  });
});

describe('defaults', () => {
  it('exports the spec-pinned starting values', () => {
    expect(GLICKO_DEFAULT_RATING).toBe(1500);
    expect(GLICKO_DEFAULT_RD).toBe(350);
    expect(GLICKO_DEFAULT_VOL).toBe(0.06);
  });
});

describe('expectedScore', () => {
  it('is 0.5 for two identical ratings', () => {
    const a = { rating: 1500, rd: 100 };
    const b = { rating: 1500, rd: 100 };
    expect(expectedScore(a, b)).toBeCloseTo(0.5, 10);
  });

  it('favors the higher-rated player and is complementary (a-vs-b + b-vs-a ~= 1)', () => {
    const a = { rating: 1700, rd: 80 };
    const b = { rating: 1400, rd: 80 };
    const eAB = expectedScore(a, b);
    const eBA = expectedScore(b, a);
    expect(eAB).toBeGreaterThan(0.5);
    expect(eAB + eBA).toBeCloseTo(1, 10);
  });
});
