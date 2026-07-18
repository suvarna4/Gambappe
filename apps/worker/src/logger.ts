/**
 * pino structured logs (§16.2): log profile IDs freely, never emails/raw IPs/cookies/
 * signatures/wallet addresses.
 */
import { pino } from 'pino';

export const logger = pino({
  name: 'receipts-worker',
  level: process.env.LOG_LEVEL ?? 'info',
});
