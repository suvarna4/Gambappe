/**
 * Route-handler response helpers (design doc §9.1): success/error envelopes + `x-server-time`
 * header on every JSON response. `runRoute` wraps parse → authorize → transact → respond
 * (§4.3) so individual route files stay focused on their business logic.
 */
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ApiError, errorEnvelope, nowMs, successEnvelope } from '@receipts/core';

function withServerTime(init: { status: number }): { status: number; headers: Record<string, string> } {
  return { status: init.status, headers: { 'x-server-time': String(nowMs()) } };
}

export function jsonSuccess<T>(data: T, opts: { status?: number; meta?: unknown } = {}): NextResponse {
  return NextResponse.json(successEnvelope(data, opts.meta), withServerTime({ status: opts.status ?? 200 }));
}

export function jsonError(err: unknown): NextResponse {
  if (ApiError.is(err)) {
    return NextResponse.json(errorEnvelope(err), withServerTime({ status: err.status }));
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      errorEnvelope('VALIDATION_FAILED', 'request validation failed', err.flatten()),
      withServerTime({ status: 400 }),
    );
  }
   
  console.error('unhandled route error', err);
  return NextResponse.json(errorEnvelope('INTERNAL', 'internal error'), withServerTime({ status: 500 }));
}

/** Runs `handler`, mapping any thrown error to the §9.1 error envelope. */
export async function runRoute(handler: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await handler();
  } catch (err) {
    return jsonError(err);
  }
}
