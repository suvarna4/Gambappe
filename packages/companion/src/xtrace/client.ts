/**
 * xTrace REST client (docs/xtrace-hackathon-tasks.md XH-T2). The only file in the repo
 * allowed to call the xTrace HTTP API directly — every other task goes through this.
 *
 * Fail-open contract: `ingest` and `search` NEVER throw. Any failure (non-2xx, timeout,
 * network error, zod parse failure) logs via `logger` and degrades to `false` / `[]`. This
 * mirrors `packages/venues/src/http-client.ts`'s retry/backoff mechanics, but diverges on
 * purpose: venues throws on failure (callers zod-validate and treat errors as hard
 * failures), while a memory-store outage here must never break the request/render path.
 * The retry helper is reimplemented locally rather than imported — venues is venue-scoped.
 */
import { COMPANION_SEARCH_LIMIT, XTRACE_MAX_RETRIES, XTRACE_TIMEOUT_MS } from '@receipts/core';

import { xtraceGroupSchema, xtraceIngestAcceptedSchema, xtraceSearchResponseSchema } from './schemas.js';

export const XTRACE_DEFAULT_API_BASE = 'https://api.production.xtrace.ai';

export const pairingGroupId = (pairingId: string) => `pairing:${pairingId}`;
export const pairingConvId = (pairingId: string, profileId: string) =>
  `pairing:${pairingId}:${profileId}`;
// Reserved for a future season-episode ingest; no XH task calls this — do not invent a
// season-scoped ingest to justify it.
export const seasonConvId = (seasonId: string, profileId: string) =>
  `season:${seasonId}:${profileId}`;

export interface XtraceClientOptions {
  apiBase: string;
  apiKey: string;
  appId: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  logger?: (msg: string, err?: unknown) => void;
}

export interface IngestTurn {
  role: 'user' | 'assistant';
  content: string;
  date?: string;
}

export interface IngestArgs {
  userId: string;
  convId: string;
  messages: IngestTurn[];
  groupIds?: string[];
  agentId?: string;
}

export interface SearchArgs {
  query: string;
  userId?: string;
  groupIds?: string[];
  include?: Array<'fact' | 'artifact' | 'episode'>;
  limit?: number;
}

export interface XtraceMemory {
  id: string;
  type: string;
  text: string;
  score: number | null;
}

export interface CreateGroupArgs {
  name: string;
}

export interface XtraceClient {
  ingest(args: IngestArgs): Promise<boolean>;
  search(args: SearchArgs): Promise<XtraceMemory[]>;
  createGroup(args: CreateGroupArgs): Promise<string | null>;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Full jitter: uniform(0, base * 2^attempt) — avoids thundering-herd retries. */
function jitteredBackoff(attempt: number, baseDelayMs: number): number {
  const cap = baseDelayMs * 2 ** attempt;
  return Math.random() * cap;
}

export function createXtraceClient(opts: XtraceClientOptions): XtraceClient {
  const apiBase = opts.apiBase;
  const timeoutMs = opts.timeoutMs ?? XTRACE_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? XTRACE_MAX_RETRIES;
  const baseDelayMs = 250;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const logger = opts.logger ?? console.warn;

  /**
   * POSTs `body` to `path`, retrying on 429/5xx/network errors/timeouts up to `maxRetries`.
   * Returns the parsed JSON body on 2xx, or `undefined` if every attempt failed — the caller
   * decides the fail-open value (`false` / `[]`), never a thrown error.
   */
  async function postWithRetry(path: string, body: unknown): Promise<unknown> {
    const url = `${apiBase}${path}`;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': opts.apiKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        logger(`xtrace POST ${path}: network error`, err);
        if (attempt < maxRetries) {
          await sleep(jitteredBackoff(attempt, baseDelayMs));
          continue;
        }
        return undefined;
      }
      clearTimeout(timer);

      if (!res.ok) {
        logger(`xtrace POST ${path}: status ${res.status}`);
        if (isRetryableStatus(res.status) && attempt < maxRetries) {
          await sleep(jitteredBackoff(attempt, baseDelayMs));
          continue;
        }
        return undefined;
      }

      try {
        return await res.json();
      } catch (err) {
        logger(`xtrace POST ${path}: invalid JSON response`, err);
        return undefined;
      }
    }

    return undefined;
  }

  async function ingest(args: IngestArgs): Promise<boolean> {
    const body = await postWithRetry('/v1/memories', {
      messages: args.messages,
      user_id: args.userId,
      conv_id: args.convId,
      app_id: opts.appId,
      group_ids: args.groupIds ?? [],
      agent_id: args.agentId ?? null,
    });
    if (body === undefined) return false;

    const parsed = xtraceIngestAcceptedSchema.safeParse(body);
    if (!parsed.success) {
      logger('xtrace POST /v1/memories: response failed schema validation', parsed.error);
      return false;
    }
    return true;
  }

  async function search(args: SearchArgs): Promise<XtraceMemory[]> {
    const body = await postWithRetry('/v1/memories/search', {
      query: args.query,
      mode: 'retrieve',
      user_id: args.userId ?? null,
      group_ids: args.groupIds ?? [],
      app_id: opts.appId,
      include: args.include,
    });
    if (body === undefined) return [];

    const parsed = xtraceSearchResponseSchema.safeParse(body);
    if (!parsed.success) {
      logger('xtrace POST /v1/memories/search: response failed schema validation', parsed.error);
      return [];
    }

    const limit = args.limit ?? COMPANION_SEARCH_LIMIT;
    return parsed.data.data.slice(0, limit).map((m) => ({
      id: m.id,
      type: m.type,
      text: m.text,
      score: m.score ?? null,
    }));
  }

  async function createGroup(args: CreateGroupArgs): Promise<string | null> {
    const body = await postWithRetry('/v1/groups', {
      name: args.name,
      app_id: opts.appId,
    });
    if (body === undefined) return null;

    const parsed = xtraceGroupSchema.safeParse(body);
    if (!parsed.success) {
      logger('xtrace POST /v1/groups: response failed schema validation', parsed.error);
      return null;
    }
    return parsed.data.id;
  }

  return { ingest, search, createGroup };
}

export function xtraceClientFromEnv(env: NodeJS.ProcessEnv = process.env): XtraceClient | null {
  const apiKey = env.XTRACE_API_KEY;
  const appId = env.XTRACE_APP_ID;
  if (!apiKey || !appId) return null;

  return createXtraceClient({
    apiBase: env.XTRACE_API_BASE ?? XTRACE_DEFAULT_API_BASE,
    apiKey,
    appId,
  });
}
