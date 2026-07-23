/**
 * XH-T3 AC: happy path per kind, money-word filtering (incl. morphological variants),
 * refusal/RateLimitError/null-parsed_output all degrade to null, generatorFromEnv gating.
 * Anthropic is faked with a minimal `{ messages: { parse: vi.fn() } }` double — no network.
 */
import { APIConnectionError, APIError, RateLimitError } from '@anthropic-ai/sdk';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { createGenerator, generatorFromEnv } from '../src/generate.js';
import type { BanterContext, CalloutDraftContext, RecapContext } from '../src/prompts.js';

function fakeClient(parseImpl: (...args: unknown[]) => Promise<unknown>): Anthropic {
  return { messages: { parse: vi.fn(parseImpl) } } as unknown as Anthropic;
}

const BANTER_CTX: BanterContext = {
  viewerHandle: 'fox-4821',
  opponentHandle: 'kingfisher-0042',
  record: { wins: 5, losses: 3, draws: 1 },
  currentWeek: { scoreViewer: 2, scoreOpponent: 1, daysRemaining: 3 },
  lastVerdictLine: 'fox-4821 took it by a hair.',
  memory: [],
};

const DRAFT_CTX: CalloutDraftContext = {
  challengerHandle: 'fox-4821',
  targetHandle: 'kingfisher-0042',
  record: { wins: 5, losses: 3, draws: 1 },
  memory: [],
};

const RECAP_CTX: RecapContext = {
  handle: 'fox-4821',
  seasonName: 'Season 3',
  stats: {
    pairings: 4,
    wins: 10,
    losses: 6,
    draws: 1,
    bestStreak: 5,
    calloutsSent: 3,
    calloutsWon: 2,
  },
  verdictLines: ['fox-4821 took week 1.'],
  memory: [],
};

describe('createGenerator — happy path', () => {
  it('banter: returns filtered lines from a valid parsed_output', async () => {
    const client = fakeClient(async () => ({
      stop_reason: 'end_turn',
      parsed_output: { lines: ['clean banter line'] },
    }));
    const generator = createGenerator(client);
    expect(await generator.banter(BANTER_CTX)).toEqual(['clean banter line']);
  });

  it('calloutDrafts: returns filtered lines from a valid parsed_output', async () => {
    const client = fakeClient(async () => ({
      stop_reason: 'end_turn',
      parsed_output: { lines: ['rematch, right now'] },
    }));
    const generator = createGenerator(client);
    expect(await generator.calloutDrafts(DRAFT_CTX)).toEqual(['rematch, right now']);
  });

  it('seasonRecap: returns the parsed title/paragraphs', async () => {
    const client = fakeClient(async () => ({
      stop_reason: 'end_turn',
      parsed_output: { title: 'Season 3, closed out', paragraphs: ['a clean recap paragraph'] },
    }));
    const generator = createGenerator(client);
    expect(await generator.seasonRecap(RECAP_CTX)).toEqual({
      title: 'Season 3, closed out',
      paragraphs: ['a clean recap paragraph'],
    });
  });
});

describe('createGenerator — money-word filtering', () => {
  it('drops a money-word line but keeps the clean one', async () => {
    const client = fakeClient(async () => ({
      stop_reason: 'end_turn',
      parsed_output: { lines: ['no more betting against me', 'clean banter line'] },
    }));
    const generator = createGenerator(client);
    expect(await generator.banter(BANTER_CTX)).toEqual(['clean banter line']);
  });

  it('returns null when every line is filtered', async () => {
    const client = fakeClient(async () => ({
      stop_reason: 'end_turn',
      parsed_output: { lines: ['you staked everything', '$50 on the line'] },
    }));
    const generator = createGenerator(client);
    expect(await generator.banter(BANTER_CTX)).toBeNull();
  });

  it('returns null when the recap title is filtered, even with clean paragraphs', async () => {
    const client = fakeClient(async () => ({
      stop_reason: 'end_turn',
      parsed_output: { title: 'wagering wrapped', paragraphs: ['a clean recap paragraph'] },
    }));
    const generator = createGenerator(client);
    expect(await generator.seasonRecap(RECAP_CTX)).toBeNull();
  });

  it('drops a filtered recap paragraph but keeps a clean one', async () => {
    const client = fakeClient(async () => ({
      stop_reason: 'end_turn',
      parsed_output: {
        title: 'Season 3, closed out',
        paragraphs: ['you bet on the wrong rival', 'a clean recap paragraph'],
      },
    }));
    const generator = createGenerator(client);
    expect(await generator.seasonRecap(RECAP_CTX)).toEqual({
      title: 'Season 3, closed out',
      paragraphs: ['a clean recap paragraph'],
    });
  });
});

describe('createGenerator — fail-open', () => {
  it('refusal stop_reason degrades to null', async () => {
    const client = fakeClient(async () => ({ stop_reason: 'refusal', parsed_output: null }));
    const generator = createGenerator(client);
    await expect(generator.banter(BANTER_CTX)).resolves.toBeNull();
  });

  it('null parsed_output degrades to null', async () => {
    const client = fakeClient(async () => ({ stop_reason: 'end_turn', parsed_output: null }));
    const generator = createGenerator(client);
    await expect(generator.banter(BANTER_CTX)).resolves.toBeNull();
  });

  it('a thrown RateLimitError degrades to null, never throws', async () => {
    const client = fakeClient(async () => {
      throw new RateLimitError(429, {}, 'rate limited', new Headers());
    });
    const generator = createGenerator(client);
    await expect(generator.banter(BANTER_CTX)).resolves.toBeNull();
  });

  it('a thrown APIConnectionError degrades to null, never throws', async () => {
    const client = fakeClient(async () => {
      throw new APIConnectionError({ message: 'connection failed' });
    });
    const generator = createGenerator(client);
    await expect(generator.calloutDrafts(DRAFT_CTX)).resolves.toBeNull();
  });

  it('a thrown generic APIError degrades to null, never throws', async () => {
    const client = fakeClient(async () => {
      throw new APIError(400, {}, 'bad request', new Headers());
    });
    const generator = createGenerator(client);
    await expect(generator.seasonRecap(RECAP_CTX)).resolves.toBeNull();
  });

  it('an unrecognized thrown error degrades to null, never throws', async () => {
    const client = fakeClient(async () => {
      throw new Error('boom');
    });
    const generator = createGenerator(client);
    await expect(generator.banter(BANTER_CTX)).resolves.toBeNull();
  });
});

describe('generatorFromEnv', () => {
  it('returns null when ANTHROPIC_API_KEY is unset', () => {
    expect(generatorFromEnv({})).toBeNull();
  });

  it('returns a generator when ANTHROPIC_API_KEY is set', () => {
    expect(generatorFromEnv({ ANTHROPIC_API_KEY: 'test-key' })).not.toBeNull();
  });
});
