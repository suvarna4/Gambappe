import { describe, expect, it } from 'vitest';
import { computeJobHealth, type JobHeartbeatRow } from '../lib/ops-dashboard';

const NOW = new Date('2026-07-20T12:00:00Z');

function row(overrides: Partial<JobHeartbeatRow> = {}): JobHeartbeatRow {
  return {
    jobName: 'settlement:poll',
    lastStartedAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    ...overrides,
  };
}

describe('computeJobHealth (§16.1)', () => {
  it('flags settlement:poll stale past its pinned 15-minute threshold', () => {
    const [health] = computeJobHealth(
      [row({ jobName: 'settlement:poll', lastSuccessAt: new Date(NOW.getTime() - 16 * 60_000) })],
      NOW,
    );
    expect(health!.stale).toBe(true);
  });

  it('does not flag settlement:poll stale within its threshold', () => {
    const [health] = computeJobHealth(
      [row({ jobName: 'settlement:poll', lastSuccessAt: new Date(NOW.getTime() - 10 * 60_000) })],
      NOW,
    );
    expect(health!.stale).toBe(false);
  });

  it('flags venue:price-tick stale past its pinned 5-minute threshold', () => {
    const [health] = computeJobHealth(
      [row({ jobName: 'venue:price-tick', lastSuccessAt: new Date(NOW.getTime() - 6 * 60_000) })],
      NOW,
    );
    expect(health!.stale).toBe(true);
  });

  it('gives a daily job (analytics:rollup) generous slack — 90 min ago is not stale', () => {
    const [health] = computeJobHealth(
      [row({ jobName: 'analytics:rollup', lastSuccessAt: new Date(NOW.getTime() - 90 * 60_000) })],
      NOW,
    );
    expect(health!.stale).toBe(false);
  });

  it('flags a daily job stale after more than 26 hours', () => {
    const [health] = computeJobHealth(
      [row({ jobName: 'analytics:rollup', lastSuccessAt: new Date(NOW.getTime() - 27 * 3600_000) })],
      NOW,
    );
    expect(health!.stale).toBe(true);
  });

  it('never flags a queue-only job stale on cadence alone, even with no success ever', () => {
    const [health] = computeJobHealth([row({ jobName: 'wallet:ingest', lastSuccessAt: null })], NOW);
    expect(health!.stale).toBe(false);
  });

  it('flags a job with no recorded success ever as stale (unless queue-only)', () => {
    const [health] = computeJobHealth([row({ jobName: 'settlement:poll', lastSuccessAt: null })], NOW);
    expect(health!.stale).toBe(true);
  });

  it('falls back to the 90-minute default for an unlisted job name', () => {
    const stale = computeJobHealth(
      [row({ jobName: 'some:future-job', lastSuccessAt: new Date(NOW.getTime() - 91 * 60_000) })],
      NOW,
    )[0]!;
    const notStale = computeJobHealth(
      [row({ jobName: 'some:future-job', lastSuccessAt: new Date(NOW.getTime() - 89 * 60_000) })],
      NOW,
    )[0]!;
    expect(stale.stale).toBe(true);
    expect(notStale.stale).toBe(false);
  });

  it('marks erroring true when the last error is more recent than the last success', () => {
    const [health] = computeJobHealth(
      [
        row({
          jobName: 'settlement:poll',
          lastSuccessAt: new Date(NOW.getTime() - 20 * 60_000),
          lastErrorAt: new Date(NOW.getTime() - 5 * 60_000),
          lastError: 'boom',
        }),
      ],
      NOW,
    );
    expect(health!.erroring).toBe(true);
  });

  it('marks erroring false when a later success has superseded an old error', () => {
    const [health] = computeJobHealth(
      [
        row({
          jobName: 'settlement:poll',
          lastSuccessAt: new Date(NOW.getTime() - 1 * 60_000),
          lastErrorAt: new Date(NOW.getTime() - 20 * 60_000),
          lastError: 'transient blip, since recovered',
        }),
      ],
      NOW,
    );
    expect(health!.erroring).toBe(false);
  });
});
