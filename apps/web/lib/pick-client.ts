/**
 * Client-side (browser) typed fetch wrappers for the viewer island (§10.2 spectator-page
 * architecture, WS7-T2) and the "me" surfaces built on top of it (reveal sequence, settings).
 * These call the REAL `/api/v1/*` HTTP paths per §9.2 — unlike `question-view.ts` (which reads
 * Postgres directly for SSR), browser JS has no DB access, so there's no mock-start shortcut
 * here. All routes below are merged; callers must still treat every call as fallible and
 * degrade gracefully — never crash the page — since that's also just correct behavior for any
 * network call in production.
 */
import {
  createPickBodySchema,
  createPickResponseSchema,
  deleteMeBodySchema,
  deleteMeResponseSchema,
  deletePickResponseSchema,
  errorEnvelopeSchema,
  getMeResponseSchema,
  getQuestionResponseSchema,
  getRevealResponseSchema,
  updateSettingsBodySchema,
  updateSettingsResponseSchema,
  type ErrorCode,
  type QuestionPublic,
  type RevealPayload,
} from '@receipts/core';
import type { z } from 'zod';

type CreatePickBody = z.infer<typeof createPickBodySchema>;
type CreatePickResponse = z.infer<typeof createPickResponseSchema>;
type GetMeResponse = z.infer<typeof getMeResponseSchema>;
type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>;
type UpdateSettingsResponse = z.infer<typeof updateSettingsResponseSchema>;
type DeleteMeResponse = z.infer<typeof deleteMeResponseSchema>;

/** Thrown for both transport failures and `{error}` envelopes — callers switch on `.code`. */
export class ApiClientError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'PARSE_ERROR';
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiClientError['code'], message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface ApiResult<T> {
  data: T;
  /** `x-server-time` (§9.1) — ms epoch, used by callers to compute the clock offset. */
  serverTimeMs: number | null;
}

/**
 * Generic over the schema `S` (deriving the result type via `z.output<S>`) rather than a
 * caller-declared `T` bound through `z.ZodType<T>` — several response schemas here have
 * defaulted fields (e.g. `profileSettingsSchema`'s `notifications.*`), which makes their zod
 * Input and Output types differ; a `z.ZodType<T>` parameter assumes Input===Output===T and
 * produces a spurious "two different types with this name exist" error under `tsc` once that
 * assumption breaks.
 */
/** Exported for reuse by other client-side typed fetch wrappers (e.g. `thread-client.ts`) that
 * want the same envelope-unwrap/error-mapping behavior without duplicating it. */
export async function request<S extends z.ZodTypeAny>(
  input: string,
  init: RequestInit,
  schema: S,
): Promise<ApiResult<z.output<S>>> {
  let res: Response;
  try {
    res = await fetch(input, { ...init, credentials: 'same-origin' });
  } catch (err) {
    throw new ApiClientError(
      'NETWORK_ERROR',
      err instanceof Error ? err.message : 'network error',
      0,
    );
  }

  const serverTimeHeader = res.headers.get('x-server-time');
  const serverTimeMs = serverTimeHeader ? Number(serverTimeHeader) : null;

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiClientError('PARSE_ERROR', 'invalid JSON response', res.status);
  }

  if (!res.ok) {
    const parsedError = errorEnvelopeSchema.safeParse(body);
    if (parsedError.success) {
      const { code, message, details } = parsedError.data.error;
      throw new ApiClientError(code, message, res.status, details);
    }
    throw new ApiClientError(
      'PARSE_ERROR',
      `unexpected error shape (HTTP ${res.status})`,
      res.status,
    );
  }

  const envelope = (body as { data?: unknown }) ?? {};
  const parsed = schema.safeParse(envelope.data);
  if (!parsed.success) {
    throw new ApiClientError(
      'PARSE_ERROR',
      'response failed schema validation',
      res.status,
      parsed.error.flatten(),
    );
  }
  return {
    data: parsed.data,
    serverTimeMs: serverTimeMs !== null && !Number.isNaN(serverTimeMs) ? serverTimeMs : null,
  };
}

/** `GET /api/v1/me` (§9.2, ghost+). Not merged yet — see file header. Called on mount without
 * blocking paint (§10.2) — see `ViewerStrip`'s SPEC-GAP note on why it's unconditional rather
 * than cookie-gated. */
export function fetchMe(): Promise<ApiResult<GetMeResponse>> {
  return request('/api/v1/me', { method: 'GET' }, getMeResponseSchema);
}

/** `GET /api/v1/questions/:slug` — used for the §10.2 30s state poll. Not merged yet (WS3-T2, see file header). */
export function fetchQuestion(slug: string): Promise<ApiResult<QuestionPublic>> {
  return request(
    `/api/v1/questions/${encodeURIComponent(slug)}`,
    { method: 'GET' },
    getQuestionResponseSchema,
  );
}

/** `POST /api/v1/questions/:id/picks` (§6.2). Not merged yet (WS3-T2).
 * `async` so a client-side `.strict()` validation failure on `body` rejects the returned
 * promise like every other failure mode here, instead of throwing synchronously. */
export async function placePick(
  questionId: string,
  body: CreatePickBody,
): Promise<ApiResult<CreatePickResponse>> {
  const parsedBody = createPickBodySchema.parse(body);
  return request(
    `/api/v1/questions/${encodeURIComponent(questionId)}/picks`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsedBody),
    },
    createPickResponseSchema,
  );
}

/** `DELETE /api/v1/picks/:id` (§6.2 undo). Not merged yet (WS3-T2). */
export function undoPick(pickId: string): Promise<ApiResult<{ deleted: true }>> {
  return request(
    `/api/v1/picks/${encodeURIComponent(pickId)}`,
    { method: 'DELETE' },
    deletePickResponseSchema,
  );
}

/** `GET /api/v1/questions/:slug/reveal` (§6.7, WS7-T3's reveal sequence). Requires ghost+
 * identity (`UNAUTHENTICATED` for a caller with no ghost/claimed cookie at all — the caller
 * treats that the same as "didn't pick this one") and 423s `REVEAL_NOT_READY` until the
 * question's raw status has actually flipped (§6.5 publication rule); `RevealSequence` only
 * calls this once `question.status === 'revealed'` already, so a 423 there means replication
 * lag, not a real not-yet-revealed state — it retries briefly rather than treating it as fatal. */
export function fetchReveal(slug: string): Promise<ApiResult<RevealPayload>> {
  return request(
    `/api/v1/questions/${encodeURIComponent(slug)}/reveal`,
    { method: 'GET' },
    getRevealResponseSchema,
  );
}

/** `PATCH /api/v1/me/settings` (§9.2, §9.4, WS7-T9 settings UI). A partial `ProfileSettings`
 * patch — the server merges it onto the stored settings, so callers only ever send the field(s)
 * that actually changed. Claimed-only (`UNAUTHENTICATED` otherwise).
 * `async` so a client-side `.strict()` validation failure on `body` rejects the returned promise
 * like every other failure mode here (mirrors `placePick`'s own note above). */
export async function updateSettings(
  body: UpdateSettingsBody,
): Promise<ApiResult<UpdateSettingsResponse>> {
  const parsedBody = updateSettingsBodySchema.parse(body);
  return request(
    '/api/v1/me/settings',
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsedBody),
    },
    updateSettingsResponseSchema,
  );
}

/** `DELETE /api/v1/me` (§9.2, §11.4, WS7-T9 settings UI). `confirm` must exactly match the
 * caller's CURRENT handle (server re-checks this — the settings UI's typed-confirm input is a
 * UX affordance, not the actual guard) — a mismatch surfaces as `VALIDATION_FAILED`. Claimed-only.
 * `async` for the same reason as `updateSettings` above (a synchronous parse failure — an empty
 * `confirm` — must reject the returned promise, not throw). */
export async function deleteMe(confirm: string): Promise<ApiResult<DeleteMeResponse>> {
  const parsedBody = deleteMeBodySchema.parse({ confirm });
  return request(
    '/api/v1/me',
    {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsedBody),
    },
    deleteMeResponseSchema,
  );
}
