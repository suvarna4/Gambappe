/**
 * GET /api/health (WS0-T4 AC): verifies Postgres + Redis connectivity.
 * 200 when both stores answer, 503 otherwise. Sets x-server-time (§9.1 convention).
 */
import { NextResponse } from 'next/server';
import { nowMs } from '@receipts/core';
import { getPool, getRedis } from '@/lib/stores';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type CheckState = 'ok' | 'error';

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function checkPostgres(): Promise<CheckState> {
  try {
    await withTimeout(getPool().query('SELECT 1'), 2_000);
    return 'ok';
  } catch {
    return 'error';
  }
}

async function checkRedis(): Promise<CheckState> {
  try {
    const redis = getRedis();
    if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
    await withTimeout(redis.ping(), 2_000);
    return 'ok';
  } catch {
    return 'error';
  }
}

export async function GET(): Promise<NextResponse> {
  const [postgres, redis] = await Promise.all([checkPostgres(), checkRedis()]);
  const healthy = postgres === 'ok' && redis === 'ok';
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      checks: { postgres, redis },
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'x-server-time': String(nowMs()), 'cache-control': 'no-store' },
    },
  );
}
