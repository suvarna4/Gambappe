/**
 * XH-T2 AC: fail-open contract (never throws), retry/backoff on 429/5xx/network/timeout,
 * no retry on other 4xx or malformed JSON, documented request/response shapes,
 * xtraceClientFromEnv gating. Fetch is injected — no msw, no real network (repo precedent:
 * packages/venues/src/http-client.ts's fetchImpl injection).
 */
import { COMPANION_SEARCH_LIMIT, XTRACE_MAX_RETRIES } from '@receipts/core';
import { describe, expect, it, vi } from 'vitest';

import { createXtraceClient, xtraceClientFromEnv } from '../src/xtrace/client.js';

const OPTS = { apiBase: 'https://xtrace.test', apiKey: 'secret-key', appId: 'receipts-test' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createXtraceClient — ingest', () => {
  it('sends the documented body shape and returns true on 202', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured = init;
      return jsonResponse(202, { id: 'job-1', status: 'accepted' });
    });

    const client = createXtraceClient({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });
    const ok = await client.ingest({
      userId: 'profile-1',
      convId: 'pairing:p1:profile-1',
      messages: [{ role: 'user', content: 'hi' }],
      groupIds: ['pairing:p1'],
    });

    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://xtrace.test/v1/memories');
    expect(captured?.headers).toMatchObject({ 'x-api-key': 'secret-key' });
    expect(JSON.parse(captured!.body as string)).toEqual({
      messages: [{ role: 'user', content: 'hi' }],
      user_id: 'profile-1',
      conv_id: 'pairing:p1:profile-1',
      app_id: 'receipts-test',
      group_ids: ['pairing:p1'],
      agent_id: null,
    });
  });

  it('retries 500s up to maxRetries then returns false', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return jsonResponse(500, { detail: { code: 'boom', message: 'boom' } });
    });

    const client = createXtraceClient({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });
    const ok = await client.ingest({
      userId: 'profile-1',
      convId: 'pairing:p1:profile-1',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(ok).toBe(false);
    expect(calls).toBe(XTRACE_MAX_RETRIES + 1);
  });

  it('does not retry a non-retryable 400', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return jsonResponse(400, { detail: { code: 'bad_request', message: 'nope' } });
    });

    const client = createXtraceClient({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });
    const ok = await client.ingest({
      userId: 'profile-1',
      convId: 'pairing:p1:profile-1',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(ok).toBe(false);
    expect(calls).toBe(1);
  });

  it('retries a timeout up to maxRetries then returns false', async () => {
    let calls = 0;
    const fetchImpl = vi.fn((_url: string | URL, init?: RequestInit) => {
      calls++;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('The operation timed out.')),
        );
      });
    });

    const client = createXtraceClient({
      ...OPTS,
      timeoutMs: 20,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const ok = await client.ingest({
      userId: 'profile-1',
      convId: 'pairing:p1:profile-1',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(ok).toBe(false);
    expect(calls).toBe(XTRACE_MAX_RETRIES + 1);
  });

  it('never throws — a network error degrades to false', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    const client = createXtraceClient({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(
      client.ingest({
        userId: 'profile-1',
        convId: 'pairing:p1:profile-1',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).resolves.toBe(false);
  });
});

describe('createXtraceClient — search', () => {
  it('parses a canned response, caps at limit, and passes mode: retrieve', async () => {
    const memories = Array.from({ length: 5 }, (_, i) => ({
      id: `mem-${i}`,
      type: 'fact',
      text: `memory ${i}`,
      user_id: 'profile-1',
      group_ids: ['pairing:p1'],
      score: 1 - i * 0.1,
      created_at: '2026-07-01T00:00:00Z',
    }));
    let captured: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured = init;
      return jsonResponse(200, { object: 'search', data: memories });
    });

    const client = createXtraceClient({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });
    const results = await client.search({
      query: 'rivalry banter grudges history',
      groupIds: ['pairing:p1'],
      include: ['fact', 'episode'],
      limit: 3,
    });

    expect(results).toEqual([
      { id: 'mem-0', type: 'fact', text: 'memory 0', score: 1 },
      { id: 'mem-1', type: 'fact', text: 'memory 1', score: 0.9 },
      { id: 'mem-2', type: 'fact', text: 'memory 2', score: 0.8 },
    ]);
    expect(JSON.parse(captured!.body as string)).toMatchObject({
      query: 'rivalry banter grudges history',
      mode: 'retrieve',
      group_ids: ['pairing:p1'],
      app_id: 'receipts-test',
      include: ['fact', 'episode'],
    });
  });

  it('caps at COMPANION_SEARCH_LIMIT when no limit is given', async () => {
    const memories = Array.from({ length: COMPANION_SEARCH_LIMIT + 5 }, (_, i) => ({
      id: `mem-${i}`,
      type: 'fact',
      text: `memory ${i}`,
      score: null,
    }));
    const fetchImpl = vi.fn(async () => jsonResponse(200, { object: 'search', data: memories }));

    const client = createXtraceClient({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });
    const results = await client.search({ query: 'season rivalry highlights grudges' });

    expect(results).toHaveLength(COMPANION_SEARCH_LIMIT);
  });

  it('returns [] without retrying on malformed JSON', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return new Response('{not json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = createXtraceClient({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });
    const results = await client.search({ query: 'anything' });

    expect(results).toEqual([]);
    expect(calls).toBe(1);
  });

  it('retries 429s up to maxRetries then returns []', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return jsonResponse(429, { detail: { code: 'rate_limited', message: 'slow down' } });
    });

    const client = createXtraceClient({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });
    const results = await client.search({ query: 'anything' });

    expect(results).toEqual([]);
    expect(calls).toBe(XTRACE_MAX_RETRIES + 1);
  });
});

describe('createXtraceClient — createGroup', () => {
  it('sends the documented body shape and returns the parsed id on 2xx', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured = init;
      return jsonResponse(200, {
        object: 'group',
        id: 'grp_abc123',
        name: 'pairing:p1',
        prompt: null,
        status: 'active',
        created_at: '2026-07-24T00:00:00Z',
        updated_at: '2026-07-24T00:00:00Z',
      });
    });

    const client = createXtraceClient({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });
    const groupId = await client.createGroup({ name: 'pairing:p1' });

    expect(groupId).toBe('grp_abc123');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://xtrace.test/v1/groups');
    expect(JSON.parse(captured!.body as string)).toEqual({
      name: 'pairing:p1',
      app_id: 'receipts-test',
    });
  });

  it('retries 500s up to maxRetries then returns null', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return jsonResponse(500, { detail: { code: 'boom', message: 'boom' } });
    });

    const client = createXtraceClient({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });
    const groupId = await client.createGroup({ name: 'pairing:p1' });

    expect(groupId).toBeNull();
    expect(calls).toBe(XTRACE_MAX_RETRIES + 1);
  });

  it('does not retry a non-retryable 400', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return jsonResponse(400, { detail: { code: 'bad_request', message: 'nope' } });
    });

    const client = createXtraceClient({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });
    const groupId = await client.createGroup({ name: 'pairing:p1' });

    expect(groupId).toBeNull();
    expect(calls).toBe(1);
  });

  it('returns null without retrying on malformed JSON', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return new Response('{not json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = createXtraceClient({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });
    const groupId = await client.createGroup({ name: 'pairing:p1' });

    expect(groupId).toBeNull();
    expect(calls).toBe(1);
  });

  it('never throws — a network error degrades to null', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    const client = createXtraceClient({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.createGroup({ name: 'pairing:p1' })).resolves.toBeNull();
  });
});

describe('xtraceClientFromEnv', () => {
  it('returns null when required env vars are missing', () => {
    expect(xtraceClientFromEnv({})).toBeNull();
    expect(xtraceClientFromEnv({ XTRACE_API_KEY: 'k' })).toBeNull();
    expect(xtraceClientFromEnv({ XTRACE_APP_ID: 'a' })).toBeNull();
  });

  it('returns a client when apiKey and appId are set', () => {
    const client = xtraceClientFromEnv({ XTRACE_API_KEY: 'k', XTRACE_APP_ID: 'a' });
    expect(client).not.toBeNull();
  });
});
