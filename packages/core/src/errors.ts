/**
 * Error codes (design doc Appendix C) + ApiError + envelope helpers (§9.1).
 * Error envelope: `{error: {code, message, details?}}`; success: resource or `{data, meta?}`.
 */
import { z } from 'zod';

/** Code → HTTP status, exactly per Appendix C. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CSRF_REJECTED: 403,
  NOT_FOUND: 404,
  ALREADY_PICKED: 409,
  CLAIM_CONFLICT: 409,
  WALLET_ALREADY_LINKED: 409,
  /** WS10-T2 (§15.2): a daily question already exists for that question_date. */
  DUPLICATE_DAILY_QUESTION: 409,
  /** WS10-T4 (§15.4): the report was already resolved (dismissed/actioned) by another call. */
  REPORT_ALREADY_RESOLVED: 409,
  QUESTION_LOCKED: 422,
  UNDO_EXPIRED: 422,
  HANDLE_COOLDOWN: 422,
  WALLET_RELINK_COOLDOWN: 422,
  ELIGIBILITY_NOT_MET: 422,
  AGE_ATTESTATION_REQUIRED: 422,
  NONCE_EXPIRED: 422,
  SIGNATURE_INVALID: 422,
  REVEAL_NOT_READY: 423,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  PRICE_UNAVAILABLE: 503,
  /** XH-T1: degraded companion (xTrace/Claude) generation — distinct from
   * PRICE_UNAVAILABLE, which is venue-pricing-specific and must not be reused. */
  COMPANION_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export const ERROR_CODE_NAMES = Object.keys(ERROR_CODES) as ErrorCode[];

export function httpStatusFor(code: ErrorCode): number {
  return ERROR_CODES[code];
}

/** The one application error type; API handlers map it onto the envelope + status. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = details;
  }

  static is(err: unknown): err is ApiError {
    return err instanceof ApiError;
  }
}

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export interface SuccessEnvelope<T, M = unknown> {
  data: T;
  meta?: M;
}

/** Build the §9.1 error envelope from a code or an ApiError. */
export function errorEnvelope(
  codeOrError: ErrorCode | ApiError,
  message?: string,
  details?: unknown,
): ErrorEnvelope {
  if (ApiError.is(codeOrError)) {
    return {
      error: {
        code: codeOrError.code,
        message: codeOrError.message,
        ...(codeOrError.details !== undefined ? { details: codeOrError.details } : {}),
      },
    };
  }
  return {
    error: {
      code: codeOrError,
      message: message ?? codeOrError,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

/** Build the §9.1 success envelope (`{data, meta?}`). */
export function successEnvelope<T, M = unknown>(data: T, meta?: M): SuccessEnvelope<T, M> {
  return meta === undefined ? { data } : { data, meta };
}

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODE_NAMES as [ErrorCode, ...ErrorCode[]]),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
