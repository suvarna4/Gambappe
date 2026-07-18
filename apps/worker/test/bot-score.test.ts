/**
 * WS11-T2 unit AC: "synthetic bot pattern scores ≥0.8, human pattern ≤0.3" — pure, no DB.
 */
import { describe, expect, it } from 'vitest';
import { combineBotScore, type BotSignals } from '../src/jobs/bot-score.js';

const BOT_PATTERN: BotSignals = {
  latencyMeanMs: 200, // sub-second
  latencyStdDevMs: 50, // uniform
  maxIpFanout: 15, // many profiles behind one ip_hash/day
  distinctActiveHours: 24, // active every hour
  distinctUaHashes: 8, // high UA churn
};

const HUMAN_PATTERN: BotSignals = {
  latencyMeanMs: 5000, // several seconds' reaction time
  latencyStdDevMs: 3000, // naturally variable
  maxIpFanout: 1, // alone on their ip_hash
  distinctActiveHours: 10, // clusters into waking hours
  distinctUaHashes: 1, // one device
};

describe('combineBotScore (§14.2 AC)', () => {
  it('scores a synthetic bot pattern at or above the exclude threshold (0.8)', () => {
    expect(combineBotScore(BOT_PATTERN)).toBeGreaterThanOrEqual(0.8);
  });

  it('scores a human pattern at or below 0.3', () => {
    expect(combineBotScore(HUMAN_PATTERN)).toBeLessThanOrEqual(0.3);
  });

  it('treats missing signals as neutral (0 contribution), not NaN/crash', () => {
    const score = combineBotScore({
      latencyMeanMs: null,
      latencyStdDevMs: null,
      maxIpFanout: null,
      distinctActiveHours: null,
      distinctUaHashes: null,
    });
    expect(score).toBe(0);
  });

  it('requires BOTH fast and uniform for the latency signal to fire', () => {
    // Fast but highly variable (not "uniform") — a human occasionally reacting instantly.
    const fastButVariable = combineBotScore({
      latencyMeanMs: 200,
      latencyStdDevMs: 5000,
      maxIpFanout: 1,
      distinctActiveHours: 10,
      distinctUaHashes: 1,
    });
    expect(fastButVariable).toBeLessThanOrEqual(0.3);
  });

  it('never exceeds 1 or goes below 0 regardless of extreme inputs', () => {
    const extreme = combineBotScore({
      latencyMeanMs: -1000,
      latencyStdDevMs: -1000,
      maxIpFanout: 10_000,
      distinctActiveHours: 24,
      distinctUaHashes: 10_000,
    });
    expect(extreme).toBeLessThanOrEqual(1);
    expect(extreme).toBeGreaterThanOrEqual(0);
  });
});
