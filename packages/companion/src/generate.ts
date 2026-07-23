/**
 * Claude generation service (docs/xtrace-hackathon-tasks.md XH-T3): the only file in the repo
 * allowed to call the Claude API for companion content. Three kinds — banter, callout drafts,
 * season recap — all sharing the same structured-output + fail-open + money-word-filter
 * pipeline.
 *
 * zod dialect note: `@anthropic-ai/sdk`'s `zodOutputFormat` (helpers/zod) calls the v4-only
 * `z.toJSONSchema()` on whatever schema it's given. This repo's `zod` dependency defaults to
 * the v3 classic API (confirmed empirically: passing a schema built with the plain `zod`
 * import throws "Cannot read properties of undefined (reading 'def')" inside the SDK). The
 * schemas below are therefore built from the `zod/v4` subpath purely to feed
 * `zodOutputFormat` — everywhere else in the repo (including this package's own public
 * schemas) stays on v3. Their bounds MUST stay in lockstep with the v3 response schemas in
 * `packages/core/src/schemas/companion.ts`: the raw generated string is stored and later
 * re-parsed by those v3 schemas (XH-T6/T7/T8), so a bound mismatch here would let an
 * out-of-bounds string through generation only to silently blank the surface downstream.
 */
import Anthropic, {
  APIConnectionError,
  APIError,
  RateLimitError,
  type AutoParseableOutputFormat,
} from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  COMPANION_BANTER_MAX_LINES,
  COMPANION_DRAFT_MAX,
  COMPANION_MAX_OUTPUT_TOKENS,
  COMPANION_MODEL,
  COMPANION_SEARCH_LIMIT,
  COMPANION_LLM_TIMEOUT_MS,
  type SeasonRecapContent,
} from '@receipts/core';
import { z } from 'zod/v4';

import { filterLines } from './filter.js';
import {
  buildBanterPrompt,
  buildCalloutDraftPrompt,
  buildRecapPrompt,
  type BanterContext,
  type CalloutDraftContext,
  type RecapContext,
} from './prompts.js';

export type { BanterContext, CalloutDraftContext, RecapContext };

const banterOutputSchema = z.object({
  lines: z.array(z.string().min(1).max(280)).min(1).max(COMPANION_BANTER_MAX_LINES),
});
const calloutDraftOutputSchema = z.object({
  lines: z.array(z.string().min(1).max(280)).min(1).max(COMPANION_DRAFT_MAX),
});
// Bounds (120/600/4) must match packages/core/src/schemas/companion.ts's seasonRecapContentSchema.
const recapOutputSchema = z.object({
  title: z.string().min(1).max(120),
  paragraphs: z.array(z.string().min(1).max(600)).min(1).max(4),
});

export interface Generator {
  banter(ctx: BanterContext): Promise<string[] | null>;
  calloutDrafts(ctx: CalloutDraftContext): Promise<string[] | null>;
  seasonRecap(ctx: RecapContext): Promise<SeasonRecapContent | null>;
}

/** Defensive truncation before prompting: caps item count and per-item length. */
function truncateMemory(memory: string[]): string[] {
  return memory.slice(0, COMPANION_SEARCH_LIMIT).map((line) => line.slice(0, 500));
}

function logGenerateError(err: unknown): void {
  if (err instanceof RateLimitError) {
    console.warn('companion generate: rate limited');
  } else if (err instanceof APIConnectionError) {
    console.warn('companion generate: connection error');
  } else if (err instanceof APIError) {
    console.warn(`companion generate: API error (status ${err.status ?? 'unknown'})`);
  } else {
    console.warn('companion generate: unexpected error', err);
  }
}

async function runGenerate<T>(
  client: Anthropic,
  system: string,
  user: string,
  format: AutoParseableOutputFormat<T>,
): Promise<T | null> {
  try {
    const message = await client.messages.parse({
      model: COMPANION_MODEL,
      max_tokens: COMPANION_MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { format },
    });
    if (message.stop_reason === 'refusal') {
      console.warn('companion generate: model refused');
      return null;
    }
    if (message.parsed_output === null) {
      console.warn('companion generate: parsed_output was null');
      return null;
    }
    return message.parsed_output;
  } catch (err) {
    logGenerateError(err);
    return null;
  }
}

export function createGenerator(client: Anthropic): Generator {
  async function banter(ctx: BanterContext): Promise<string[] | null> {
    const prompt = buildBanterPrompt({ ...ctx, memory: truncateMemory(ctx.memory) });
    const result = await runGenerate(
      client,
      prompt.system,
      prompt.user,
      zodOutputFormat(banterOutputSchema),
    );
    if (result === null) return null;
    const filtered = filterLines(result.lines);
    return filtered.length > 0 ? filtered : null;
  }

  async function calloutDrafts(ctx: CalloutDraftContext): Promise<string[] | null> {
    const prompt = buildCalloutDraftPrompt({ ...ctx, memory: truncateMemory(ctx.memory) });
    const result = await runGenerate(
      client,
      prompt.system,
      prompt.user,
      zodOutputFormat(calloutDraftOutputSchema),
    );
    if (result === null) return null;
    const filtered = filterLines(result.lines);
    return filtered.length > 0 ? filtered : null;
  }

  async function seasonRecap(ctx: RecapContext): Promise<SeasonRecapContent | null> {
    const prompt = buildRecapPrompt({ ...ctx, memory: truncateMemory(ctx.memory) });
    const result = await runGenerate(
      client,
      prompt.system,
      prompt.user,
      zodOutputFormat(recapOutputSchema),
    );
    if (result === null) return null;

    const title = filterLines([result.title]);
    if (title.length === 0) return null;
    const paragraphs = filterLines(result.paragraphs);
    if (paragraphs.length === 0) return null;

    return { title: title[0]!, paragraphs };
  }

  return { banter, calloutDrafts, seasonRecap };
}

export function generatorFromEnv(env: NodeJS.ProcessEnv = process.env): Generator | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({
    apiKey,
    timeout: COMPANION_LLM_TIMEOUT_MS,
    maxRetries: 0,
  });
  return createGenerator(client);
}
